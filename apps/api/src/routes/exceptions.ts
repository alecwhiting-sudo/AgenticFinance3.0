/**
 * Exceptions workbench (plans/P2P.md §10): the queue of invoices needing
 * judgement, each with the evidence side by side (PO vs received vs invoiced),
 * the agent's grounded resolution options, and one-click apply. Humans decide;
 * every applied option is recorded as an executed command for the audit trail.
 */
import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { command, workItem } from "@af/db";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { resolveInvoiceException, type ResolveParams } from "../services/invoiceIntake.js";

type Option = {
  resolution: string;
  label: string;
  rationale: string;
  costedNote?: string;
  adjustedQuantities?: { lineNo: number; qty: number }[];
};

export function exceptionRoutes(app: FastifyInstance): void {
  /** Open exceptions, grouped-ready: supplier, amount, kind, age, and whether
   * the agent has already attached resolution options. */
  app.get("/p2p/exceptions", async () => {
    const db = requireDb();
    const rows = (
      await db.execute(sql`
        select i.id, i.supplier_invoice_number as number, i.invoice_date, i.gross_minor,
               i.exception_code, i.case_id, s.name as supplier_name,
               (current_date - i.invoice_date)::int as age_days,
               exists (select 1 from evidence.case_event ce
                       where ce.case_id = i.case_id and ce.kind = 'options') as has_options,
               exists (select 1 from agent.work_item w
                       where w.case_id = i.case_id and w.status in ('pending','claimed','running')) as investigating
        from erp.ap_invoice i join erp.supplier s on s.id = i.supplier_id
        where i.book <> 'test' and i.status = 'exception'
        order by i.exception_code, i.invoice_date
      `)
    ).rows;
    return rows;
  });

  /** One exception, evidence assembled: the invoice, its purchase, receipts,
   * a per-line 3-way diff, supplier history, the case timeline, and the
   * latest agent options. */
  app.get<{ Params: { id: string } }>("/p2p/exceptions/:id", async (req, reply) => {
    const db = requireDb();
    const inv = await db.query.apInvoice.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!inv) return reply.code(404).send({ error: "invoice not found" });
    const supplier = await db.query.supplier.findFirst({ where: (t) => eq(t.id, inv.supplierId) });
    const purchase = inv.purchaseId
      ? await db.query.purchase.findFirst({ where: (t) => eq(t.id, inv.purchaseId!) })
      : null;
    const receipts = purchase
      ? await db.query.goodsReceipt.findMany({ where: (t) => eq(t.purchaseId, purchase.id) })
      : [];
    const receivedBy = new Map<number, number>();
    for (const g of receipts)
      for (const q of g.quantities) receivedBy.set(q.lineNo, (receivedBy.get(q.lineNo) ?? 0) + q.qtyReceived);

    // the 3-way diff, per line: what was approved, what arrived, what was billed
    const diff = inv.lines.map((l) => {
      const pl = purchase?.lines.find((x) => x.lineNo === l.lineNo) ?? null;
      return {
        lineNo: l.lineNo,
        description: l.description,
        approvedQty: pl?.qty ?? null,
        approvedPriceMinor: pl?.unitPriceMinor ?? null,
        receivedQty: purchase ? (receivedBy.get(l.lineNo) ?? 0) : null,
        invoicedQty: l.qty,
        invoicedPriceMinor: l.unitPriceMinor,
        varianceMinor: pl ? l.qty * l.unitPriceMinor - pl.qty * pl.unitPriceMinor : null,
      };
    });

    const caseEvents = inv.caseId
      ? await db.query.caseEvent.findMany({
          where: (t) => eq(t.caseId, inv.caseId!),
          orderBy: (t) => t.at,
        })
      : [];
    const optionsEvent = [...caseEvents].reverse().find((e) => e.kind === "options");
    const options = ((optionsEvent?.detail as { options?: Option[] } | null)?.options ?? []) as Option[];

    const [history] = (
      await db.execute(sql`
        select count(*)::int as invoices,
               count(*) filter (where status = 'exception')::int as open_exceptions,
               count(*) filter (where status = 'paid')::int as paid
        from erp.ap_invoice where book <> 'test' and supplier_id = ${inv.supplierId}
      `)
    ).rows as { invoices: number; open_exceptions: number; paid: number }[];

    const investigating = inv.caseId
      ? await db.query.workItem.findFirst({
          where: (t, { and: a, eq: e, inArray }) =>
            a(e(t.caseId, inv.caseId!), inArray(t.status, ["pending", "claimed", "running"])),
        })
      : null;

    return {
      invoice: inv,
      supplier,
      purchase,
      receipts,
      diff,
      caseEvents,
      options,
      supplierHistory: history,
      investigating: !!investigating,
      emailPath: inv.emailPath,
    };
  });

  /** Ask the Invoice Exception Agent to investigate and attach options —
   * on-demand model spend, never automatic for bulk-loaded exceptions. */
  app.post<{ Params: { id: string } }>("/p2p/exceptions/:id/investigate", async (req, reply) => {
    const db = requireDb();
    const inv = await db.query.apInvoice.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!inv || inv.status !== "exception") return reply.code(409).send({ error: "not an open exception" });
    const agentRow = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "invoice-exception") });
    if (!agentRow) return reply.code(409).send({ error: "invoice-exception agent not seeded" });
    const note = inv.caseId
      ? await db.query.caseEvent.findFirst({ where: (t) => eq(t.caseId, inv.caseId!) })
      : null;
    const detail = String((note?.detail as { detail?: string } | null)?.detail ?? inv.exceptionCode);
    const [wi] = await db
      .insert(workItem)
      .values({
        type: "invoice.exception",
        agentId: agentRow.id,
        caseId: inv.caseId,
        payload: {
          invoiceId: inv.id,
          caseId: inv.caseId,
          exceptionCode: inv.exceptionCode,
          detail,
          objective:
            "Investigate using get_invoice_context, then (1) propose case.options with 2-3 grounded, costed resolution options (params: caseId, options[{resolution: approve_adjusted|part_approve|record_receipt|reject|retro_purchase|human_verify, label, rationale, costedNote?, adjustedQuantities?}]) and (2) propose ap.invoice.resolve for your single recommended option. Never resolve bank_detail_change — options there are human_verify guidance only.",
        },
        priority: 3,
      })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: "workbench",
      verb: "requested_investigation",
      objectType: "ap_invoice",
      objectId: inv.id,
      caseId: inv.caseId ?? undefined,
      summary: `Exception ${inv.exceptionCode} on ${inv.supplierInvoiceNumber} sent to the Invoice Exception Agent for options`,
    });
    return { workItemId: wi!.id };
  });

  /** A human applies one of the options (or their own resolution). Executes
   * through the same resolve service as an approved command and records an
   * executed command row so the decision history stays complete. */
  app.post<{
    Params: { id: string };
    Body: { resolution: string; rationale: string; adjustedQuantities?: { lineNo: number; qty: number }[]; decidedBy: string };
  }>("/p2p/exceptions/:id/apply", async (req, reply) => {
    const db = requireDb();
    const { resolution, rationale, adjustedQuantities, decidedBy } = req.body ?? ({} as never);
    if (!resolution || !rationale || !decidedBy)
      return reply.code(400).send({ error: "resolution, rationale and decidedBy required" });
    if (resolution === "human_verify")
      return reply.code(400).send({ error: "human_verify is guidance, not an executable resolution — verify out of band, then reject or re-capture" });
    const params: ResolveParams = {
      invoiceId: req.params.id,
      resolution: resolution as ResolveParams["resolution"],
      rationale,
      ...(adjustedQuantities ? { adjustedQuantities } : {}),
    };
    const result = await resolveInvoiceException(db, params, decidedBy);
    await db.insert(command).values({
      type: "ap.invoice.resolve",
      params: params as unknown as Record<string, unknown>,
      idempotencyKey: `workbench:${req.params.id}:${Date.now()}`,
      requiresApproval: true,
      status: "executed",
      decidedBy,
      decisionReason: "applied from the exceptions workbench",
      decidedAt: new Date(),
      result,
    });
    // cancel any still-pending agent proposal for this invoice — the human decided
    await db.execute(sql`
      update agent.command set status = 'rejected', decided_by = ${decidedBy},
        decision_reason = 'superseded: resolved from the exceptions workbench', decided_at = now()
      where status = 'proposed' and type = 'ap.invoice.resolve' and params->>'invoiceId' = ${req.params.id}
    `);
    return { ok: true, result };
  });

  /** Recently resolved — so the workbench can show the queue draining. */
  app.get("/p2p/exceptions-resolved", async () => {
    const db = requireDb();
    const rows = await db.query.command.findMany({
      where: (t) => eq(t.type, "ap.invoice.resolve"),
      orderBy: (t) => desc(t.decidedAt),
      limit: 10,
    });
    return rows.filter((r) => r.status === "executed");
  });
}
