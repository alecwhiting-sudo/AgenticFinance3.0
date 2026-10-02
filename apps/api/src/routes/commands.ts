import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { caseEvent, command } from "@af/db";
import { createPurchase, type CreatePurchaseParams } from "../services/purchaseIntake.js";
import { captureInvoice, resolveInvoiceException, type CaptureInvoiceData, type ResolveParams } from "../services/invoiceIntake.js";
import { commandDefs, proposeCommandSchema, type CommandType } from "@af/shared";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";

/** Execute an approved/auto-approved command inside deterministic services. */
async function executeCommand(
  type: CommandType,
  params: Record<string, unknown>,
  actor = "standing-authority",
): Promise<Record<string, unknown>> {
  const db = requireDb();
  switch (type) {
    case "case.note": {
      const caseId = params.caseId as string | undefined;
      if (caseId) {
        const c = await db.query.evidenceCase.findFirst({
          where: (t, { eq: e }) => e(t.id, caseId),
        });
        if (!c) throw Object.assign(new Error("case not found"), { statusCode: 404 });
        await db.insert(caseEvent).values({
          caseId,
          actorType: "agent",
          actorId: "command-gateway",
          kind: "note",
          detail: { note: params.note },
        });
      }
      return { noted: true };
    }
    case "ap.invoice.capture": {
      return captureInvoice(db, params as CaptureInvoiceData) as Promise<Record<string, unknown>>;
    }
    case "ap.invoice.resolve": {
      return resolveInvoiceException(db, params as ResolveParams, actor);
    }
    case "bank.txn.post": {
      const { postBankTxn } = await import("../services/bankRec.js");
      const p = params as { bankTransactionId: string; accountCode: string; rationale: string };
      return postBankTxn(db, {
        bankTransactionId: p.bankTransactionId,
        accountCode: p.accountCode,
        memo: p.rationale.slice(0, 120),
        postedBy: actor,
      }) as Promise<Record<string, unknown>>;
    }
    case "purchase.create": {
      const created = await createPurchase(db, params as CreatePurchaseParams);
      return {
        purchaseId: created.id,
        number: created.number,
        totalMinor: created.totalMinor,
        approvalBand: created.approvalBand,
        status: created.status,
      };
    }
  }
}

export function commandRoutes(app: FastifyInstance): void {
  /**
   * The command gateway (ARCHITECTURE.md §4). Validates the command type is
   * registered, params match its schema, the proposing run's release holds the
   * permission, and the idempotency key is fresh. Auto-executes commands that
   * need no approval; parks the rest for a human.
   */
  app.post("/commands/propose", async (req, reply) => {
    const db = requireDb();
    const body = proposeCommandSchema.parse(req.body);

    const existing = await db.query.command.findFirst({
      where: (t) => eq(t.idempotencyKey, body.idempotencyKey),
    });
    if (existing) return existing; // idempotent replay returns the original

    const def = commandDefs[body.type];
    const params = def.params.parse(body.params);

    const run = await db.query.agentRun.findFirst({ where: (t) => eq(t.id, body.runId) });
    if (!run) return reply.code(404).send({ error: "run not found" });
    const release = await db.query.agentRelease.findFirst({
      where: (t) => eq(t.id, run.releaseId),
    });
    if (!release || !release.commandPermissions.includes(body.type)) {
      await emitActivity({
        actorType: "system",
        actorId: "command-gateway",
        verb: "rejected_command",
        objectType: "command",
        objectId: body.type,
        summary: `Gateway refused ${body.type}: release lacks permission`,
      });
      return reply.code(403).send({ error: `release has no permission for ${body.type}` });
    }

    const [created] = await db
      .insert(command)
      .values({
        type: body.type,
        params,
        idempotencyKey: body.idempotencyKey,
        runId: run.id,
        agentId: run.agentId,
        releaseId: run.releaseId,
        requiresApproval: def.requiresApproval,
        status: def.requiresApproval ? "proposed" : "approved",
        decidedBy: def.requiresApproval ? null : "standing-authority",
        decidedAt: def.requiresApproval ? null : new Date(),
      })
      .returning();

    if (!def.requiresApproval) {
      try {
        const result = await executeCommand(body.type, params);
        await db
          .update(command)
          .set({ status: "executed", result })
          .where(eq(command.id, created!.id));
        await emitActivity({
          actorType: "system",
          actorId: "command-gateway",
          verb: "executed_command",
          objectType: "command",
          objectId: created!.id,
          summary: `Executed ${body.type} under standing authority`,
        });
        return { ...created!, status: "executed", result };
      } catch (err) {
        await db
          .update(command)
          .set({ status: "failed", result: { error: String(err) } })
          .where(eq(command.id, created!.id));
        return reply.code(500).send({ error: `command execution failed: ${String(err)}` });
      }
    }

    await emitActivity({
      actorType: "system",
      actorId: "command-gateway",
      verb: "queued_for_approval",
      objectType: "command",
      objectId: created!.id,
      summary: `${body.type} awaits human approval`,
    });
    return created;
  });

  app.get<{ Querystring: { status?: string } }>("/commands", async (req) => {
    const db = requireDb();
    const status = (req.query.status ?? "proposed") as typeof command.$inferSelect.status;
    const rows = await db.query.command.findMany({
      where: (t) => eq(t.status, status),
      orderBy: (t) => desc(t.createdAt),
      limit: 100,
    });
    // Enrich each command with what/why/who context so the approvals inbox can
    // render a decision card instead of raw params (UI_CONVENTIONS §2.4).
    return Promise.all(
      rows.map(async (cmd) => {
        const agent = cmd.agentId
          ? await db.query.agent.findFirst({ where: (t) => eq(t.id, cmd.agentId!) })
          : undefined;
        let context: Record<string, unknown> | null = null;
        const invoiceId = (cmd.params as Record<string, unknown>).invoiceId as string | undefined;
        if (cmd.type === "ap.invoice.resolve" && invoiceId) {
          const inv = await db.query.apInvoice.findFirst({ where: (t) => eq(t.id, invoiceId) });
          if (inv) {
            const supplier = await db.query.supplier.findFirst({ where: (t) => eq(t.id, inv.supplierId) });
            context = {
              invoiceId: inv.id,
              invoiceNumber: inv.supplierInvoiceNumber,
              supplierName: supplier?.name ?? null,
              grossMinor: inv.grossMinor,
              exceptionCode: inv.exceptionCode,
              documentPath: inv.documentPath,
            };
          }
        }
        return { ...cmd, agentName: agent?.name ?? cmd.agentId, context };
      }),
    );
  });

  app.post<{ Params: { id: string }; Body: { decidedBy: string; reason?: string; approve: boolean } }>(
    "/commands/:id/decide",
    async (req, reply) => {
      const db = requireDb();
      const { decidedBy, reason, approve } = req.body;
      if (!decidedBy) return reply.code(400).send({ error: "decidedBy required" });
      const cmd = await db.query.command.findFirst({ where: (t) => eq(t.id, req.params.id) });
      if (!cmd) return reply.code(404).send({ error: "command not found" });
      if (cmd.status !== "proposed")
        return reply.code(409).send({ error: `command is ${cmd.status}, not proposed` });

      if (!approve) {
        await db
          .update(command)
          .set({ status: "rejected", decidedBy, decisionReason: reason, decidedAt: new Date() })
          .where(eq(command.id, cmd.id));
        await emitActivity({
          actorType: "human",
          actorId: decidedBy,
          verb: "rejected_command",
          objectType: "command",
          objectId: cmd.id,
          summary: `${decidedBy} rejected ${cmd.type}${reason ? `: ${reason}` : ""}`,
        });
        return { ok: true };
      }

      const result = await executeCommand(cmd.type as CommandType, cmd.params, decidedBy);
      await db
        .update(command)
        .set({ status: "executed", decidedBy, decisionReason: reason, decidedAt: new Date(), result })
        .where(eq(command.id, cmd.id));
      await emitActivity({
        actorType: "human",
        actorId: decidedBy,
        verb: "approved_command",
        objectType: "command",
        objectId: cmd.id,
        summary: `${decidedBy} approved ${cmd.type}; executed`,
      });
      return { ok: true, result };
    },
  );
}
