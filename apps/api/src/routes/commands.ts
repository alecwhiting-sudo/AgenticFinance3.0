import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { caseEvent, command } from "@af/db";
import { createPurchase, type CreatePurchaseParams } from "../services/purchaseIntake.js";
import { captureInvoice, resolveInvoiceException, type CaptureInvoiceData, type ResolveParams } from "../services/invoiceIntake.js";
import { commandDefs, proposeCommandSchema, type CommandType } from "@af/shared";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { MAIN_BOOK, TEST_BOOK, runInBook } from "../lib/bookContext.js";

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
    case "case.options": {
      const p = params as { caseId: string; options: unknown[] };
      const c = await db.query.evidenceCase.findFirst({ where: (t, { eq: e }) => e(t.id, p.caseId) });
      if (!c) throw Object.assign(new Error("case not found"), { statusCode: 404 });
      await db.insert(caseEvent).values({
        caseId: p.caseId,
        actorType: "agent",
        actorId: actor,
        kind: "options",
        detail: { options: p.options },
      });
      return { optionsRecorded: p.options.length };
    }
    case "ap.invoice.capture": {
      return captureInvoice(db, params as CaptureInvoiceData) as Promise<Record<string, unknown>>;
    }
    case "ap.invoice.resolve": {
      return resolveInvoiceException(db, params as ResolveParams, actor);
    }
    case "ar.receipt.apply": {
      const { applyReceipt } = await import("../services/arIntake.js");
      const p = params as { bankTransactionId: string; invoiceId: string };
      return applyReceipt(db, { ...p, postedBy: actor }) as Promise<Record<string, unknown>>;
    }
    case "ar.dunning.send": {
      const p = params as { invoiceId: string; text: string };
      const { arDunning } = await import("@af/db");
      const inv = await db.query.arInvoice.findFirst({ where: (t) => eq(t.id, p.invoiceId) });
      if (!inv) throw Object.assign(new Error("ar invoice not found"), { statusCode: 404 });
      await db.insert(arDunning).values({ invoiceId: inv.id, text: p.text, sentBy: actor });
      await emitActivity({
        actorType: "human",
        actorId: actor,
        verb: "sent_dunning",
        objectType: "ar_invoice",
        objectId: inv.id,
        summary: `Dunning letter for ${inv.number} approved and sent (simulated)`,
      });
      return { sent: true, invoiceNumber: inv.number };
    }
    case "report.commentary.save": {
      const p = params as { periodCode: string; text: string };
      const { reportCommentary } = await import("@af/db");
      await db.insert(reportCommentary).values({
        periodCode: p.periodCode,
        text: p.text,
        draftedBy: actor,
      });
      return { saved: true, periodCode: p.periodCode };
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
    // Display-only case commands (notes, resolution options) move no money and
    // change no books — every release may write to its own cases without a
    // per-release grant, so adding one never requires re-releasing live agents.
    const displayOnly = body.type === "case.note" || body.type === "case.options";
    if (!release || (!displayOnly && !release.commandPermissions.includes(body.type))) {
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

    // D16 book code: a command proposed by an eval run executes into the
    // TEST book — full pipeline, real gateway, real posting, but statements,
    // analytics and the approvals inbox never see it. The gateway derives
    // the book itself (run → work item type), so no caller can spoof it.
    const workItemRow = run.workItemId
      ? await db.query.workItem.findFirst({ where: (t) => eq(t.id, run.workItemId!) })
      : null;
    const book = workItemRow?.type === "eval.case" ? TEST_BOOK : MAIN_BOOK;

    const [created] = await db
      .insert(command)
      .values({
        type: body.type,
        params,
        idempotencyKey: body.idempotencyKey,
        runId: run.id,
        agentId: run.agentId,
        releaseId: run.releaseId,
        book,
        requiresApproval: def.requiresApproval,
        status: def.requiresApproval ? "proposed" : "approved",
        decidedBy: def.requiresApproval ? null : "standing-authority",
        decidedAt: def.requiresApproval ? null : new Date(),
      })
      .returning();

    if (!def.requiresApproval) {
      try {
        const result = await runInBook(book, () => executeCommand(body.type, params));
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
    // D16: test-book commands (eval runs) never reach the human inbox
    const rows = await db.query.command.findMany({
      where: (t, { and, ne }) => and(eq(t.status, status), ne(t.book, TEST_BOOK)),
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
        if (cmd.type === "bank.txn.post") {
          const p = cmd.params as { bankTransactionId?: string; accountCode?: string };
          const txn = p.bankTransactionId
            ? await db.query.bankTransaction.findFirst({ where: (t) => eq(t.id, p.bankTransactionId!) })
            : null;
          if (txn)
            context = {
              kind: "bank",
              reference: txn.reference,
              counterparty: txn.counterparty,
              amountMinor: txn.amountMinor,
              accountCode: p.accountCode ?? null,
            };
        }
        if (cmd.type === "ar.receipt.apply") {
          const p = cmd.params as { bankTransactionId?: string; invoiceId?: string };
          const txn = p.bankTransactionId
            ? await db.query.bankTransaction.findFirst({ where: (t) => eq(t.id, p.bankTransactionId!) })
            : null;
          const inv = p.invoiceId
            ? await db.query.arInvoice.findFirst({ where: (t) => eq(t.id, p.invoiceId!) })
            : null;
          if (txn && inv)
            context = {
              kind: "receipt",
              reference: txn.reference,
              amountMinor: txn.amountMinor,
              invoiceId: inv.id,
              invoiceNumber: inv.number,
              grossMinor: inv.grossMinor,
            };
        }
        if (cmd.type === "ar.dunning.send") {
          const p = cmd.params as { invoiceId?: string };
          const inv = p.invoiceId
            ? await db.query.arInvoice.findFirst({ where: (t) => eq(t.id, p.invoiceId!) })
            : null;
          if (inv)
            context = {
              kind: "dunning",
              invoiceId: inv.id,
              invoiceNumber: inv.number,
              grossMinor: inv.grossMinor,
              dueDate: inv.dueDate,
            };
        }
        return { ...cmd, agentName: agent?.name ?? cmd.agentId, context };
      }),
    );
  });

  /** Decision history (UI_CONVENTIONS §2.4): every human yes/no, newest
   * first — the audit surface for "who approved what, when, and why". */
  app.get("/decisions", async () => {
    const db = requireDb();
    const rows = (
      await db.execute(sql`
        select c.id, c.type, c.status, c.decided_by, c.decision_reason, c.decided_at, c.params,
               a.name as agent_name
        from agent.command c
        left join agent.agent a on a.id = c.agent_id
        where c.decided_by is not null and c.decided_by <> 'standing-authority'
        order by c.decided_at desc limit 100
      `)
    ).rows;
    return rows;
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

      // execute in the command's own book (a human-approved main command
      // posts to main; a test-book command could only ever post to test)
      const result = await runInBook(cmd.book, () => executeCommand(cmd.type as CommandType, cmd.params, decidedBy));
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
