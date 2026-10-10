import type { FastifyInstance } from "fastify";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { arInvoice, bankTransaction, workItem } from "@af/db";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { applyReceiptsByRule } from "../services/arIntake.js";

const today = () => new Date().toISOString().slice(0, 10);

export function o2cRoutes(app: FastifyInstance): void {
  app.get("/o2c/pipeline", async () => {
    const db = requireDb();
    const rows = (
      await db.execute(sql`
        select status, count(*)::int as n, sum(gross_minor)::bigint as total
        from erp.ar_invoice group by status
      `)
    ).rows as { status: string; n: number; total: string }[];
    const aging = (
      await db.execute(sql`
        select case
            when due_date >= current_date then 'current'
            when due_date >= current_date - interval '30 days' then 'd30'
            when due_date >= current_date - interval '60 days' then 'd60'
            else 'd90' end as bucket,
          count(*)::int as n, sum(gross_minor)::bigint as total
        from erp.ar_invoice where status = 'posted' group by 1
      `)
    ).rows;
    const [{ n: openReceipts }] = (
      await db.execute(sql`
        select count(*)::int as n from erp.bank_transaction
        where kind = 'ar_receipt' and status = 'unmatched'
      `)
    ).rows as { n: number }[];
    return { statuses: rows, aging, openReceipts };
  });

  /** Receipt queries (plans/O2C.md §9 — the exceptions-workbench mirror):
   * open ar_receipt cases the Cash Application Agent raised for unmatched,
   * ambiguous or over/part payments, each with its grounded options and
   * draft query letters. Display-only; applying money stays with humans. */
  app.get("/o2c/receipt-queries", async () => {
    const db = requireDb();
    const cases = await db.query.evidenceCase.findMany({
      where: (t, { and: a, eq: e }) => a(e(t.kind, "ar_receipt"), e(t.status, "open")),
      orderBy: (t, { desc: d }) => d(t.createdAt),
      limit: 25,
    });
    const out = [];
    for (const c of cases) {
      const events = await db.query.caseEvent.findMany({
        where: (t) => eq(t.caseId, c.id),
        orderBy: (t) => t.at,
      });
      const optionsEvent = [...events].reverse().find((e) => e.kind === "options");
      const noteEvent = events.find((e) => e.kind === "note");
      out.push({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        detail: noteEvent?.detail ?? null,
        options: (optionsEvent?.detail as { options?: unknown[] } | null)?.options ?? [],
      });
    }
    return { queries: out };
  });

  app.get<{ Querystring: { status?: string; overdue?: string; limit?: string } }>(
    "/o2c/invoices",
    async (req) => {
      const db = requireDb();
      const conds = [
        req.query.status ? eq(arInvoice.status, req.query.status as typeof arInvoice.$inferSelect.status) : null,
        req.query.overdue === "true" ? and(eq(arInvoice.status, "posted"), lt(arInvoice.dueDate, today())) : null,
      ].filter((c) => c !== null);
      const rows = await db.query.arInvoice.findMany({
        where: conds.length ? and(...conds) : undefined,
        orderBy: (t) => desc(t.invoiceDate),
        limit: Math.min(Number(req.query.limit ?? 50), 500),
      });
      const customers = await db.query.customer.findMany();
      const byId = new Map(customers.map((c) => [c.id, c]));
      const t = today();
      return rows.map((i) => ({
        ...i,
        customerName: byId.get(i.customerId)?.name ?? "?",
        customerCode: byId.get(i.customerId)?.code ?? "?",
        overdue: i.status === "posted" && i.dueDate < t,
      }));
    },
  );

  app.get<{ Params: { id: string } }>("/o2c/invoices/:id", async (req, reply) => {
    const db = requireDb();
    const inv = await db.query.arInvoice.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!inv) return reply.code(404).send({ error: "not found" });
    const cust = await db.query.customer.findFirst({ where: (t) => eq(t.id, inv.customerId) });
    const dunning = await db.query.arDunning.findMany({
      where: (t) => eq(t.invoiceId, inv.id),
      orderBy: (t) => desc(t.createdAt),
    });
    const journal = inv.journalId
      ? await db.query.journal.findFirst({ where: (t) => eq(t.id, inv.journalId!) })
      : null;
    const receiptJournal = inv.receiptJournalId
      ? await db.query.journal.findFirst({ where: (t) => eq(t.id, inv.receiptJournalId!) })
      : null;
    return {
      invoice: { ...inv, overdue: inv.status === "posted" && inv.dueDate < today() },
      customer: cust ? { code: cust.code, name: cust.name, email: cust.email, paymentTermsDays: cust.paymentTermsDays } : null,
      dunning,
      journal: journal ? { id: journal.id, number: journal.number, journalDate: journal.journalDate } : null,
      receiptJournal: receiptJournal
        ? { id: receiptJournal.id, number: receiptJournal.number, journalDate: receiptJournal.journalDate }
        : null,
    };
  });

  app.get<{ Params: { code: string } }>("/erp/customers/:code", async (req, reply) => {
    const db = requireDb();
    const cust = await db.query.customer.findFirst({ where: (t) => eq(t.code, req.params.code) });
    if (!cust) return reply.code(404).send({ error: "not found" });
    const invoices = await db.query.arInvoice.findMany({
      where: (t) => eq(t.customerId, cust.id),
      orderBy: (t) => desc(t.invoiceDate),
      limit: 50,
    });
    const t = today();
    return {
      customer: { code: cust.code, name: cust.name, email: cust.email, paymentTermsDays: cust.paymentTermsDays },
      invoices: invoices.map((i) => ({ ...i, overdue: i.status === "posted" && i.dueDate < t })),
    };
  });

  /** Deterministic cash application over the open bank receipts. */
  app.post("/o2c/apply-receipts", async () => {
    const db = requireDb();
    const result = await applyReceiptsByRule(db);
    if (result.applied > 0)
      await emitActivity({
        actorType: "system",
        actorId: "cash-application-rules",
        verb: "applied_receipts",
        objectType: "bank_transaction",
        objectId: "batch",
        summary: `Cash application: ${result.applied} receipts applied; ${result.leftovers} need investigation`,
      });
    return result;
  });

  /** Hand an unapplied receipt to the Cash Application Agent, with candidate
   * open invoices so keyless runs stay grounded. */
  app.post<{ Body: { bankTransactionId: string } }>("/o2c/investigate-receipt", async (req, reply) => {
    const db = requireDb();
    const txn = await db.query.bankTransaction.findFirst({ where: (t) => eq(t.id, req.body.bankTransactionId) });
    if (!txn) return reply.code(404).send({ error: "bank transaction not found" });
    if (txn.status === "matched") return reply.code(409).send({ error: "already matched" });
    const agentRow = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "cash-application") });
    if (!agentRow) return reply.code(409).send({ error: "cash-application agent not seeded" });
    const candidates = (
      await db.execute(sql`
        select i.id, i.number, i.gross_minor, c.name as customer_name
        from erp.ar_invoice i join erp.customer c on c.id = i.customer_id
        where i.status = 'posted'
        order by abs(i.gross_minor - ${txn.amountMinor}) asc, i.due_date asc
        limit 5
      `)
    ).rows as { id: string; number: string; gross_minor: string; customer_name: string }[];
    const [wi] = await db
      .insert(workItem)
      .values({
        type: "ar.cash.apply",
        agentId: agentRow.id,
        payload: {
          bankTransactionId: txn.id,
          reference: txn.reference,
          counterparty: txn.counterparty,
          amountMinor: txn.amountMinor,
          candidates: candidates.map((c) => ({
            invoiceId: c.id,
            number: c.number,
            grossMinor: Number(c.gross_minor),
            customerName: c.customer_name,
          })),
        },
        priority: 4,
      })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: "workbench",
      verb: "queued_cash_application",
      objectType: "work_item",
      objectId: wi!.id,
      summary: `Receipt ${txn.reference} sent to the Cash Application Agent`,
    });
    return { workItemId: wi!.id };
  });

  /** Chase an overdue invoice: the Collections Agent drafts the letter. */
  app.post<{ Body: { invoiceId: string } }>("/o2c/chase", async (req, reply) => {
    const db = requireDb();
    const inv = await db.query.arInvoice.findFirst({ where: (t) => eq(t.id, req.body.invoiceId) });
    if (!inv) return reply.code(404).send({ error: "invoice not found" });
    if (inv.status !== "posted") return reply.code(409).send({ error: `invoice is ${inv.status}` });
    const cust = await db.query.customer.findFirst({ where: (t) => eq(t.id, inv.customerId) });
    const agentRow = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "collections") });
    if (!agentRow) return reply.code(409).send({ error: "collections agent not seeded" });
    const daysOverdue = Math.max(
      0,
      Math.floor((Date.now() - new Date(`${inv.dueDate}T00:00:00Z`).getTime()) / 86_400_000),
    );
    const [wi] = await db
      .insert(workItem)
      .values({
        type: "ar.collections",
        agentId: agentRow.id,
        payload: {
          invoiceId: inv.id,
          number: inv.number,
          customerName: cust?.name ?? "the customer",
          grossMinor: inv.grossMinor,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          daysOverdue,
          paymentTermsDays: cust?.paymentTermsDays ?? 30,
        },
        priority: 4,
      })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: "workbench",
      verb: "queued_collections",
      objectType: "ar_invoice",
      objectId: inv.id,
      summary: `Collections Agent asked to chase ${inv.number} (${daysOverdue} days overdue)`,
    });
    return { workItemId: wi!.id };
  });
}
