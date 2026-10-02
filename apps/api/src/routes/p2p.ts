import type { FastifyInstance } from "fastify";
import { count, desc, eq, sql } from "drizzle-orm";
import { apInvoice, apPayment, purchase, supplier, journal, journalLine, caseEvent } from "@af/db";
import { requireDb } from "../lib/db.js";
import { decidePurchase } from "../services/purchaseIntake.js";

export function p2pRoutes(app: FastifyInstance): void {
  /** Stage counts for the P2P pipeline view (plans/P2P.md M1). */
  app.get("/p2p/pipeline", async () => {
    const db = requireDb();
    const invoiceStages = await db
      .select({ status: apInvoice.status, n: count() })
      .from(apInvoice)
      .groupBy(apInvoice.status);
    const purchaseStages = await db
      .select({ status: purchase.status, n: count() })
      .from(purchase)
      .groupBy(purchase.status);
    const bands = await db
      .select({ band: purchase.approvalBand, n: count() })
      .from(purchase)
      .groupBy(purchase.approvalBand);
    const exceptions = await db
      .select({ code: apInvoice.exceptionCode, n: count() })
      .from(apInvoice)
      .where(eq(apInvoice.status, "exception"))
      .groupBy(apInvoice.exceptionCode);
    return { invoiceStages, purchaseStages, bands, exceptions };
  });

  app.get<{ Querystring: { status?: string; limit?: string } }>("/p2p/purchases", async (req) => {
    const db = requireDb();
    const rows = await db.query.purchase.findMany({
      where: req.query.status
        ? (t) => eq(t.status, req.query.status as typeof purchase.$inferSelect.status)
        : undefined,
      orderBy: (t) => desc(t.requestDate),
      limit: Math.min(Number(req.query.limit ?? 50), 200),
    });
    const suppliers = await db.query.supplier.findMany();
    const byId = new Map(suppliers.map((s) => [s.id, s.name]));
    return rows.map((p) => ({ ...p, supplierName: byId.get(p.supplierId) ?? "?" }));
  });

  app.get<{ Querystring: { status?: string; limit?: string } }>("/p2p/invoices", async (req) => {
    const db = requireDb();
    const rows = await db.query.apInvoice.findMany({
      where: req.query.status
        ? (t) => eq(t.status, req.query.status as typeof apInvoice.$inferSelect.status)
        : undefined,
      orderBy: (t) => desc(t.invoiceDate),
      limit: Math.min(Number(req.query.limit ?? 50), 200),
    });
    const suppliers = await db.query.supplier.findMany();
    const byId = new Map(suppliers.map((s) => [s.id, s.name]));
    return rows.map((i) => ({ ...i, supplierName: byId.get(i.supplierId) ?? "?" }));
  });

  app.post<{ Params: { id: string }; Body: { approve: boolean; decidedBy: string } }>(
    "/p2p/purchases/:id/decide",
    async (req, reply) => {
      const db = requireDb();
      const { approve, decidedBy } = req.body ?? ({} as { approve: boolean; decidedBy: string });
      if (typeof approve !== "boolean" || !decidedBy)
        return reply.code(400).send({ error: "approve (boolean) and decidedBy required" });
      return decidePurchase(db, req.params.id, approve, decidedBy);
    },
  );

  /** The single-record thread: requisition -> approval -> receipts -> invoices. */
  app.get<{ Params: { id: string } }>("/p2p/purchases/:id", async (req, reply) => {
    const db = requireDb();
    const p = await db.query.purchase.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!p) return reply.code(404).send({ error: "purchase not found" });
    const sup = await db.query.supplier.findFirst({ where: (t) => eq(t.id, p.supplierId) });
    const receipts = await db.query.goodsReceipt.findMany({ where: (t) => eq(t.purchaseId, p.id) });
    const invoices = await db.query.apInvoice.findMany({ where: (t) => eq(t.purchaseId, p.id) });
    return { purchase: p, supplier: sup, receipts, invoices };
  });

  app.get<{ Params: { id: string } }>("/p2p/invoices/:id", async (req, reply) => {
    const db = requireDb();
    const inv = await db.query.apInvoice.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!inv) return reply.code(404).send({ error: "invoice not found" });
    const sup = await db.query.supplier.findFirst({ where: (t) => eq(t.id, inv.supplierId) });
    const p = inv.purchaseId
      ? await db.query.purchase.findFirst({ where: (t) => eq(t.id, inv.purchaseId!) })
      : null;
    const events = inv.caseId
      ? await db.query.caseEvent.findMany({ where: (t) => eq(t.caseId, inv.caseId!) })
      : [];
    const j = inv.journalId
      ? await db.query.journal.findFirst({ where: (t) => eq(t.id, inv.journalId!) })
      : null;
    return { invoice: inv, supplier: sup, purchase: p, caseEvents: events, journal: j };
  });

  app.get<{ Params: { code: string } }>("/erp/suppliers/:code", async (req, reply) => {
    const db = requireDb();
    const sup = await db.query.supplier.findFirst({ where: (t) => eq(t.code, req.params.code) });
    if (!sup) return reply.code(404).send({ error: "supplier not found" });
    const purchases = await db.query.purchase.findMany({
      where: (t) => eq(t.supplierId, sup.id),
      orderBy: (t) => desc(t.requestDate),
      limit: 50,
    });
    const invoices = await db.query.apInvoice.findMany({
      where: (t) => eq(t.supplierId, sup.id),
      orderBy: (t) => desc(t.invoiceDate),
      limit: 50,
    });
    return { supplier: sup, purchases, invoices };
  });

  /** Ledger drill: all journal lines for an account. */
  app.get<{ Params: { code: string } }>("/erp/accounts/:code", async (req, reply) => {
    const db = requireDb();
    const acct = await db.query.account.findFirst({ where: (t) => eq(t.code, req.params.code) });
    if (!acct) return reply.code(404).send({ error: "account not found" });
    const rows = (
      await db.execute(sql`
        select jl.amount_minor, jl.memo as line_memo, j.id as journal_id, j.number,
               j.journal_date, j.memo, j.source_type, j.source_id
        from erp.journal_line jl join erp.journal j on j.id = jl.journal_id
        where jl.account_code = ${req.params.code}
        order by j.journal_date desc, j.number desc limit 200
      `)
    ).rows;
    return { account: acct, lines: rows };
  });

  app.get<{ Params: { id: string } }>("/erp/journals/:id", async (req, reply) => {
    const db = requireDb();
    const j = await db.query.journal.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!j) return reply.code(404).send({ error: "journal not found" });
    const lines = await db.query.journalLine.findMany({
      where: (t) => eq(t.journalId, j.id),
      orderBy: (t) => t.lineNo,
    });
    const accounts = await db.query.account.findMany();
    const names = new Map(accounts.map((a) => [a.code, a.name]));
    // the source document link (invoice/payment)
    let source: Record<string, unknown> | null = null;
    if (j.sourceType === "ap_invoice") {
      const inv = await db.query.apInvoice.findFirst({ where: (t) => eq(t.id, j.sourceId) });
      if (inv) source = { kind: "ap_invoice", id: inv.id, label: inv.supplierInvoiceNumber, documentPath: inv.documentPath };
    } else if (j.sourceType === "ap_payment") {
      const pay = await db.query.apPayment.findFirst({ where: (t) => eq(t.id, j.sourceId) });
      if (pay) source = { kind: "ap_payment", id: pay.id, label: pay.paymentRef };
    }
    return { journal: j, lines: lines.map((l) => ({ ...l, accountName: names.get(l.accountCode) ?? "" })), source };
  });

  /** Command palette search across entities. */
  app.get<{ Querystring: { q?: string } }>("/search", async (req) => {
    const db = requireDb();
    const q = (req.query.q ?? "").trim();
    if (q.length < 2) return [];
    const like = `%${q}%`;
    const rows = (
      await db.execute(sql`
        (select 'purchase' as kind, id::text, number as label, status::text as sub from erp.purchase
          where number ilike ${like} or business_need ilike ${like} limit 5)
        union all
        (select 'invoice', i.id::text, i.supplier_invoice_number, i.status::text from erp.ap_invoice i
          where i.supplier_invoice_number ilike ${like} limit 5)
        union all
        (select 'supplier', code, name, code from erp.supplier where name ilike ${like} or code ilike ${like} limit 5)
        union all
        (select 'agent', slug, name, status::text from agent.agent where name ilike ${like} or slug ilike ${like} limit 5)
        union all
        (select 'account', code, code || ' ' || name, type::text from erp.account where name ilike ${like} or code ilike ${like} limit 5)
      `)
    ).rows;
    return rows;
  });

  /** Trial balance from journal lines (debit positive, credit negative). */
  app.get("/erp/trial-balance", async () => {
    const db = requireDb();
    const rows = (
      await db.execute(sql`
        select a.code, a.name, a.type, coalesce(sum(jl.amount_minor), 0)::int as balance_minor
        from erp.account a
        left join erp.journal_line jl on jl.account_code = a.code
        group by a.code, a.name, a.type
        order by a.code
      `)
    ).rows as { code: string; name: string; type: string; balance_minor: number }[];
    const [{ total }] = (
      await db.execute(sql`select coalesce(sum(amount_minor),0)::bigint as total from erp.journal_line`)
    ).rows as { total: string }[];
    const [{ n: journals }] = (
      await db.execute(sql`select count(*)::int as n from erp.journal`)
    ).rows as { n: number }[];
    return { accounts: rows, controlTotalMinor: Number(total), journals };
  });
}
