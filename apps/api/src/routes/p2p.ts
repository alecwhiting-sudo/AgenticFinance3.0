import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, sql } from "drizzle-orm";
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
    // receipt + invoice rollups so the list can show the 3-way-match state at a glance
    const receipts = (
      await db.execute(sql`
        select purchase_id, count(*)::int as n,
               coalesce(sum((q.value->>'qtyReceived')::numeric), 0)::int as qty
        from erp.goods_receipt gr, jsonb_array_elements(gr.quantities) q
        group by purchase_id
      `)
    ).rows as { purchase_id: string; n: number; qty: number }[];
    const recBy = new Map(receipts.map((r) => [r.purchase_id, r]));
    const invs = (
      await db.execute(sql`
        select purchase_id, count(*)::int as n,
               count(*) filter (where status = 'exception')::int as exceptions
        from erp.ap_invoice where book <> 'test' and purchase_id is not null group by purchase_id
      `)
    ).rows as { purchase_id: string; n: number; exceptions: number }[];
    const invBy = new Map(invs.map((i) => [i.purchase_id, i]));
    return rows.map((p) => {
      const ordered = p.lines.reduce((s, l) => s + l.qty, 0);
      const r = recBy.get(p.id);
      const i = invBy.get(p.id);
      return {
        ...p,
        supplierName: byId.get(p.supplierId) ?? "?",
        qtyOrdered: ordered,
        qtyReceived: r?.qty ?? 0,
        receiptCount: r?.n ?? 0,
        invoiceCount: i?.n ?? 0,
        invoiceExceptions: i?.exceptions ?? 0,
      };
    });
  });

  app.get<{ Querystring: { status?: string; format?: string; limit?: string } }>("/p2p/invoices", async (req) => {
    const db = requireDb();
    const conds = [
      req.query.status ? eq(apInvoice.status, req.query.status as typeof apInvoice.$inferSelect.status) : null,
      req.query.format ? eq(apInvoice.format, req.query.format) : null,
    ].filter((c) => c !== null);
    const rows = await db.query.apInvoice.findMany({
      where: conds.length ? and(...conds) : undefined,
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

  /** Learned extraction templates (D15): per-supplier status and what the
   * promoted templates have saved, priced on the current rate card. */
  app.get("/p2p/templates", async () => {
    const db = requireDb();
    const rows = (
      await db.execute(sql`
        select t.supplier_code, s.name as supplier_name, t.status, t.confirmations,
               t.hits, t.misses, t.avg_model_tokens, t.promoted_at, t.last_used_at
        from agent.extraction_template t
        left join erp.supplier s on s.code = t.supplier_code
        order by t.hits desc, t.confirmations desc
      `)
    ).rows as {
      supplier_code: string; supplier_name: string | null; status: string; confirmations: number;
      hits: number; misses: number; avg_model_tokens: number; promoted_at: string | null; last_used_at: string | null;
    }[];
    const { estimateCostCents } = await import("../services/rateCard.js");
    const templates = rows.map((r) => ({
      supplierCode: r.supplier_code,
      supplierName: r.supplier_name ?? r.supplier_code,
      status: r.status,
      confirmations: r.confirmations,
      hits: r.hits,
      misses: r.misses,
      avgModelTokens: r.avg_model_tokens,
      // what the hits would have cost on the extraction tier had they gone to the model
      savedCents: estimateCostCents("extraction", r.hits * r.avg_model_tokens, 0),
      promotedAt: r.promoted_at,
    }));
    return {
      templates,
      summary: {
        active: templates.filter((t) => t.status === "active").length,
        learning: templates.filter((t) => t.status === "learning").length,
        modelCallsAvoided: templates.reduce((s, t) => s + t.hits, 0),
        savedCents: templates.reduce((s, t) => s + t.savedCents, 0),
      },
    };
  });

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
  app.get<{ Params: { code: string }; Querystring: { period?: string } }>(
    "/erp/accounts/:code",
    async (req, reply) => {
      const db = requireDb();
      const acct = await db.query.account.findFirst({ where: (t) => eq(t.code, req.params.code) });
      if (!acct) return reply.code(404).send({ error: "account not found" });
      // optional period filter so analytics charts drill to exactly the
      // postings behind one month's figure
      const period = /^\d{4}-\d{2}$/.test(req.query.period ?? "") ? req.query.period! : null;
      const rows = (
        await db.execute(sql`
          select jl.amount_minor, jl.memo as line_memo, j.id as journal_id, j.number,
                 j.journal_date, j.memo, j.source_type, j.source_id
          from erp.journal_line jl join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
          where jl.account_code = ${req.params.code}
            and (${period}::text is null or j.period_code = ${period})
          order by j.journal_date desc, j.number desc limit 200
        `)
      ).rows;
      return { account: acct, period, lines: rows };
    },
  );

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
          where book <> 'test' and (number ilike ${like} or business_need ilike ${like}) limit 5)
        union all
        (select 'invoice', i.id::text, i.supplier_invoice_number, i.status::text from erp.ap_invoice i
          where i.book <> 'test' and i.supplier_invoice_number ilike ${like} limit 5)
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
        left join (erp.journal_line jl join erp.journal j on j.id = jl.journal_id and j.book <> 'test') on jl.account_code = a.code
        group by a.code, a.name, a.type
        order by a.code
      `)
    ).rows as { code: string; name: string; type: string; balance_minor: number }[];
    const [{ total }] = (
      await db.execute(sql`select coalesce(sum(jl.amount_minor),0)::bigint as total from erp.journal_line jl join erp.journal j on j.id = jl.journal_id and j.book <> 'test'`)
    ).rows as { total: string }[];
    const [{ n: journals }] = (
      await db.execute(sql`select count(*)::int as n from erp.journal where book <> 'test'`)
    ).rows as { n: number }[];
    return { accounts: rows, controlTotalMinor: Number(total), journals };
  });
}
