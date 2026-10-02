import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { apInvoice, apPayment, bankTransaction, supplier, workItem } from "@af/db";
import { decidePaymentRun, proposePaymentRun, reconcileBank } from "../services/payments.js";
import { reconcileBankRules } from "../services/bankRec.js";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";

export function paymentRoutes(app: FastifyInstance): void {
  /** Scheduler: group due posted invoices into one proposed run (M4). */
  app.post<{ Body: { runDate?: string } }>("/p2p/payments/propose", async (req, reply) => {
    const db = requireDb();
    const runDate = req.body?.runDate ?? new Date().toISOString().slice(0, 10);
    const run = await proposePaymentRun(db, runDate);
    if (!run) return reply.code(200).send({ run: null, message: "nothing due" });
    await emitActivity({
      actorType: "system",
      actorId: "payment-scheduler",
      verb: "proposed_payment_run",
      objectType: "ap_payment",
      objectId: run.id,
      summary: `Payment run ${run.paymentRef}: ${run.invoiceIds.length} invoices, awaiting approval`,
    });
    return { run };
  });

  app.get("/p2p/payments", async () => {
    const db = requireDb();
    const runs = await db.query.apPayment.findMany({
      orderBy: (t) => desc(t.createdAt),
      limit: 100,
    });
    // Resolve invoice refs so the UI can show what each run settles.
    return Promise.all(
      runs.map(async (r) => {
        const invoices = await Promise.all(
          r.invoiceIds.slice(0, 20).map(async (id) => {
            const inv = await db.query.apInvoice.findFirst({ where: (t) => eq(t.id, id) });
            if (!inv) return null;
            const sup = await db.query.supplier.findFirst({ where: (t) => eq(t.id, inv.supplierId) });
            return {
              id: inv.id,
              number: inv.supplierInvoiceNumber,
              supplierName: sup?.name ?? null,
              grossMinor: inv.grossMinor,
            };
          }),
        );
        return { ...r, invoices: invoices.filter(Boolean), invoiceCount: r.invoiceIds.length };
      }),
    );
  });

  /** Human checkpoint: executing a run moves money (CLAUDE.md safety rule). */
  app.post<{ Params: { id: string }; Body: { approve: boolean; decidedBy: string } }>(
    "/p2p/payments/:id/decide",
    async (req, reply) => {
      const db = requireDb();
      const { approve, decidedBy } = req.body;
      if (!decidedBy) return reply.code(400).send({ error: "decidedBy required" });
      const result = await decidePaymentRun(db, req.params.id, approve, decidedBy);
      await emitActivity({
        actorType: "human",
        actorId: decidedBy,
        verb: approve ? "approved_payment_run" : "rejected_payment_run",
        objectType: "ap_payment",
        objectId: req.params.id,
        summary: approve
          ? `${decidedBy} approved payment run; settled and ${result.status}`
          : `${decidedBy} rejected payment run; invoices back to posted`,
      });
      return result;
    },
  );

  app.get<{ Querystring: { status?: string; limit?: string } }>("/p2p/bank", async (req) => {
    const db = requireDb();
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    return db.query.bankTransaction.findMany({
      ...(req.query.status === "unmatched" ? { where: eq(bankTransaction.status, "unmatched") } : {}),
      orderBy: (t) => desc(t.txnDate),
      limit,
    });
  });

  app.post("/p2p/bank/reconcile", async () => {
    const db = requireDb();
    // deterministic kind-rules first (salaries/VAT/fees post + match through
    // the platform), then the AP payment matcher (plans/R2R.md §2)
    const rules = await reconcileBankRules(db);
    const stats = await reconcileBank(db);
    if (rules.posted > 0 || stats.matched > 0)
      await emitActivity({
        actorType: "system",
        actorId: "reconciliation-matcher",
        verb: "reconciled_bank",
        objectType: "bank_transaction",
        objectId: "batch",
        summary: `Bank rec: posted ${rules.posted} lines by rule (${Object.entries(rules.byKind).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}), matched ${stats.matched} payments`,
      });
    return { ...stats, rulesPosted: rules.posted, byKind: rules.byKind };
  });

  /** Month-end postings for a period (plans/R2R.md §3) — prepayment
   * releases, accruals (+ auto-reversal of last period's), recurring
   * journals, all engine-derived through the pipe. Idempotent per period. */
  app.post<{ Body: { periodCode: string } }>("/r2r/month-end", async (req, reply) => {
    const db = requireDb();
    const periodCode = req.body?.periodCode;
    if (!periodCode || !/^\d{4}-\d{2}$/.test(periodCode))
      return reply.code(400).send({ error: "periodCode (YYYY-MM) required" });
    const { runMonthEnd } = await import("../services/monthEnd.js");
    const result = await runMonthEnd(db, periodCode);
    if (result.posted > 0)
      await emitActivity({
        actorType: "system",
        actorId: "month-end",
        verb: "ran_month_end",
        objectType: "period",
        objectId: periodCode,
        summary: `Month-end ${periodCode}: posted ${result.posted} entries (${result.entries.join(", ")})`,
      });
    return result;
  });

  /** Hand an ambiguous bank line to the Reconciliation Agent (plans/R2R.md §2). */
  app.post<{ Body: { bankTransactionId: string } }>("/r2r/bank/investigate", async (req, reply) => {
    const db = requireDb();
    const txn = await db.query.bankTransaction.findFirst({
      where: (t) => eq(t.id, req.body.bankTransactionId),
    });
    if (!txn) return reply.code(404).send({ error: "bank transaction not found" });
    if (txn.status === "matched") return reply.code(409).send({ error: "already matched" });
    const agentRow = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "reconciliation") });
    if (!agentRow) return reply.code(409).send({ error: "reconciliation agent not seeded" });
    const [wi] = await db
      .insert(workItem)
      .values({
        type: "bank.reconcile",
        agentId: agentRow.id,
        payload: {
          bankTransactionId: txn.id,
          txnDate: txn.txnDate,
          amountMinor: txn.amountMinor,
          reference: txn.reference,
          counterparty: txn.counterparty,
          kind: txn.kind,
        },
        priority: 4,
      })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: "workbench",
      verb: "queued_bank_investigation",
      objectType: "work_item",
      objectId: wi!.id,
      summary: `Bank line ${txn.reference} (${txn.counterparty}) sent to the Reconciliation Agent`,
    });
    return { workItemId: wi!.id };
  });
}
