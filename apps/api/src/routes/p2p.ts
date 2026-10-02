import type { FastifyInstance } from "fastify";
import { count, desc, eq, sql } from "drizzle-orm";
import { apInvoice, purchase } from "@af/db";
import { requireDb } from "../lib/db.js";

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
