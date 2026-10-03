import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireDb } from "../lib/db.js";

/** Phase 4c M1 (plans/ANALYTICS.md): the curated view catalogue. Every
 * endpoint here is a read-only derived aggregation over journal lines and
 * the open-item tables — never alternative measurement logic, never
 * model-generated SQL. This catalogue is also the Analyst Agent's entire
 * data surface in M2: if a question can't be answered from these views,
 * the agent says so rather than reaching past them. */

/** The catalogue, served to the UI and (M2) handed to the Analyst Agent as
 * its tool menu. `params` documents what each view accepts. */
export const VIEW_CATALOGUE = [
  {
    id: "pl-trend",
    title: "P&L trend",
    question: "How are income and expense lines moving month to month?",
    params: { year: "YYYY (default: latest year with journals)" },
    drill: "/ledger/{code}?period={period}",
  },
  {
    id: "flux",
    title: "Month flux",
    question: "Why did the result move versus the prior month?",
    params: { period: "YYYY-MM (default: latest period with P&L activity)" },
    drill: "/ledger/{code}?period={period}",
  },
  {
    id: "aging",
    title: "AP / AR aging",
    question: "Who do we owe / who owes us, and how overdue is it?",
    params: { side: "ap | ar", asOf: "YYYY-MM-DD (default: today)" },
    drill: "/p2p/invoices (ap) · /o2c (ar)",
  },
  {
    id: "counterparty",
    title: "Supplier spend / customer revenue",
    question: "Where does spend or revenue concentrate?",
    params: { dim: "supplier | customer" },
    drill: "/p2p/suppliers/{code} (supplier) · /o2c (customer)",
  },
  {
    id: "cash",
    title: "Cash position",
    question: "What is the bank balance doing over time?",
    params: {},
    drill: "/payments",
  },
] as const;

const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;

export function analyticsRoutes(app: FastifyInstance): void {
  app.get("/analytics/views", async () => ({ views: VIEW_CATALOGUE }));

  /** Monthly movement per P&L account for a year. Sign convention is the
   * ledger's (debit positive); the UI flips income for display. */
  app.get<{ Querystring: { year?: string } }>("/analytics/pl-trend", async (req) => {
    const db = requireDb();
    let year = /^\d{4}$/.test(req.query.year ?? "") ? Number(req.query.year) : undefined;
    if (!year) {
      const latest = (
        await db.execute(sql`select max(period_code) as p from erp.journal`)
      ).rows[0] as { p: string | null };
      year = latest.p ? Number(latest.p.slice(0, 4)) : new Date().getUTCFullYear();
    }
    const rows = (
      await db.execute(sql`
        select a.code, a.name, a.type, j.period_code, sum(jl.amount_minor)::bigint as amount_minor
        from erp.journal_line jl
        join erp.journal j on j.id = jl.journal_id
        join erp.account a on a.code = jl.account_code
        where a.type in ('income', 'expense') and j.period_code like ${`${year}-%`}
        group by a.code, a.name, a.type, j.period_code
        order by a.code, j.period_code
      `)
    ).rows as { code: string; name: string; type: string; period_code: string; amount_minor: string }[];
    const months = [...new Set(rows.map((r) => r.period_code))].sort();
    return {
      view: "pl-trend",
      year,
      months,
      rows: rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })),
    };
  });

  /** Per-account movement delta: period vs prior month, P&L accounts.
   * Feeds the waterfall — favourable/adverse is decided by the UI from
   * account type and sign (meaning, not raw sign). */
  app.get<{ Querystring: { period?: string } }>("/analytics/flux", async (req, reply) => {
    const db = requireDb();
    let period = /^\d{4}-\d{2}$/.test(req.query.period ?? "") ? req.query.period! : undefined;
    if (!period) {
      const latest = (
        await db.execute(sql`
          select max(j.period_code) as p from erp.journal j
          join erp.journal_line jl on jl.journal_id = j.id
          join erp.account a on a.code = jl.account_code
          where a.type in ('income', 'expense')
        `)
      ).rows[0] as { p: string | null };
      if (!latest.p) return reply.code(409).send({ error: "no P&L activity yet" });
      period = latest.p;
    }
    const prior = priorPeriod(period);
    const rows = (
      await db.execute(sql`
        select a.code, a.name, a.type,
          coalesce(sum(jl.amount_minor) filter (where j.period_code = ${period}), 0)::bigint as this_minor,
          coalesce(sum(jl.amount_minor) filter (where j.period_code = ${prior}), 0)::bigint as prev_minor
        from erp.journal_line jl
        join erp.journal j on j.id = jl.journal_id
        join erp.account a on a.code = jl.account_code
        where a.type in ('income', 'expense') and j.period_code in (${period}, ${prior})
        group by a.code, a.name, a.type
        having coalesce(sum(jl.amount_minor) filter (where j.period_code = ${period}), 0)
            <> coalesce(sum(jl.amount_minor) filter (where j.period_code = ${prior}), 0)
            or coalesce(sum(jl.amount_minor) filter (where j.period_code = ${period}), 0) <> 0
        order by a.code
      `)
    ).rows as { code: string; name: string; type: string; this_minor: string; prev_minor: string }[];
    const periods = (
      await db.execute(sql`
        select distinct j.period_code from erp.journal j
        join erp.journal_line jl on jl.journal_id = j.id
        join erp.account a on a.code = jl.account_code
        where a.type in ('income','expense') order by 1
      `)
    ).rows.map((r) => (r as { period_code: string }).period_code);
    return {
      view: "flux",
      period,
      prior,
      periods,
      rows: rows.map((r) => ({
        code: r.code,
        name: r.name,
        type: r.type,
        thisMinor: Number(r.this_minor),
        prevMinor: Number(r.prev_minor),
        deltaMinor: Number(r.this_minor) - Number(r.prev_minor),
      })),
    };
  });

  /** Open-item aging by counterparty. Open AP = not paid/rejected; open AR =
   * not paid. Buckets by days past due at asOf; not-yet-due is "current". */
  app.get<{ Querystring: { side?: string; asOf?: string } }>("/analytics/aging", async (req, reply) => {
    const db = requireDb();
    const side = req.query.side === "ar" ? "ar" : req.query.side === "ap" || !req.query.side ? "ap" : null;
    if (!side) return reply.code(400).send({ error: "side must be ap or ar" });
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf ?? "")
      ? req.query.asOf!
      : new Date().toISOString().slice(0, 10);

    const rows = (
      await db.execute(
        side === "ap"
          ? sql`
              select s.code, s.name, i.due_date, i.gross_minor, i.status
              from erp.ap_invoice i join erp.supplier s on s.id = i.supplier_id
              where i.status not in ('paid', 'rejected')
            `
          : sql`
              select c.code, c.name, i.due_date, i.gross_minor, i.status
              from erp.ar_invoice i join erp.customer c on c.id = i.customer_id
              where i.status <> 'paid'
            `,
      )
    ).rows as { code: string; name: string; due_date: string; gross_minor: string; status: string }[];

    const byParty = new Map<string, { code: string; name: string; buckets: number[]; totalMinor: number; items: number }>();
    for (const r of rows) {
      const days = Math.floor((Date.parse(asOf) - Date.parse(r.due_date)) / 86_400_000);
      const b = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
      const e = byParty.get(r.code) ?? { code: r.code, name: r.name, buckets: [0, 0, 0, 0, 0], totalMinor: 0, items: 0 };
      e.buckets[b]! += Number(r.gross_minor);
      e.totalMinor += Number(r.gross_minor);
      e.items += 1;
      byParty.set(r.code, e);
    }
    const parties = [...byParty.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    return {
      view: "aging",
      side,
      asOf,
      buckets: AGING_BUCKETS,
      totalMinor: parties.reduce((n, p) => n + p.totalMinor, 0),
      overdueMinor: parties.reduce((n, p) => n + p.buckets.slice(1).reduce((x, y) => x + y, 0), 0),
      parties,
    };
  });

  /** Ranked counterparty totals with a monthly series each — invoiced gross
   * (AP) / billed gross (AR), from the invoice tables (period = invoice
   * month). Concentration, not cash timing. */
  app.get<{ Querystring: { dim?: string } }>("/analytics/counterparty", async (req, reply) => {
    const db = requireDb();
    const dim = req.query.dim === "customer" ? "customer" : req.query.dim === "supplier" || !req.query.dim ? "supplier" : null;
    if (!dim) return reply.code(400).send({ error: "dim must be supplier or customer" });
    const rows = (
      await db.execute(
        dim === "supplier"
          ? sql`
              select s.code, s.name, to_char(i.invoice_date, 'YYYY-MM') as period_code,
                     sum(i.gross_minor)::bigint as gross_minor, count(*)::int as invoices
              from erp.ap_invoice i join erp.supplier s on s.id = i.supplier_id
              where i.status <> 'rejected'
              group by s.code, s.name, to_char(i.invoice_date, 'YYYY-MM')
              order by s.code, to_char(i.invoice_date, 'YYYY-MM')
            `
          : sql`
              select c.code, c.name, to_char(i.invoice_date, 'YYYY-MM') as period_code,
                     sum(i.gross_minor)::bigint as gross_minor, count(*)::int as invoices
              from erp.ar_invoice i join erp.customer c on c.id = i.customer_id
              group by c.code, c.name, to_char(i.invoice_date, 'YYYY-MM')
              order by c.code, to_char(i.invoice_date, 'YYYY-MM')
            `,
      )
    ).rows as { code: string; name: string; period_code: string; gross_minor: string; invoices: number }[];
    const months = [...new Set(rows.map((r) => r.period_code))].sort();
    const byParty = new Map<string, { code: string; name: string; totalMinor: number; invoices: number; series: Record<string, number> }>();
    for (const r of rows) {
      const e = byParty.get(r.code) ?? { code: r.code, name: r.name, totalMinor: 0, invoices: 0, series: {} };
      e.totalMinor += Number(r.gross_minor);
      e.invoices += r.invoices;
      e.series[r.period_code] = Number(r.gross_minor);
      byParty.set(r.code, e);
    }
    const parties = [...byParty.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    return { view: "counterparty", dim, months, parties };
  });

  /** Cumulative bank balance by transaction date (all bank lines — the
   * statement is the truth of cash whether or not it is matched yet). */
  app.get("/analytics/cash", async () => {
    const db = requireDb();
    const rows = (
      await db.execute(sql`
        select txn_date, sum(amount_minor)::bigint as day_minor,
               sum(sum(amount_minor)) over (order by txn_date)::bigint as balance_minor
        from erp.bank_transaction
        group by txn_date order by txn_date
      `)
    ).rows as { txn_date: string; day_minor: string; balance_minor: string }[];
    return {
      view: "cash",
      points: rows.map((r) => ({
        date: r.txn_date,
        dayMinor: Number(r.day_minor),
        balanceMinor: Number(r.balance_minor),
      })),
    };
  });
}

function priorPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
