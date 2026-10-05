import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireDb } from "../lib/db.js";

/** Home dashboard KPIs (plans/DATASET_V2.md PR-F): every figure here either
 * MOVES when the business moves or answers a question a CFO actually asks.
 * All derived aggregation, all book-filtered; master-data counts moved to
 * Admin. One payload so the page polls a single endpoint. */
export function dashboardRoutes(app: FastifyInstance): void {
  app.get("/dashboard/kpis", async () => {
    const db = requireDb();
    const today = new Date().toISOString().slice(0, 10);
    const currentMonth = today.slice(0, 7);

    // cash: cumulative bank balance, trailing ~45 statement days for the spark
    const cashRows = (
      await db.execute(sql`
        with daily as (
          select txn_date, sum(sum(amount_minor)) over (order by txn_date)::bigint as balance_minor
          from erp.bank_transaction group by txn_date
        )
        select * from (select * from daily order by txn_date desc limit 45) t order by txn_date
      `)
    ).rows as { txn_date: string; balance_minor: string }[];

    // result: latest complete month + the in-progress month to date
    const results = (
      await db.execute(sql`
        select j.period_code, sum(jl.amount_minor)::bigint as pl_minor
        from erp.journal_line jl
        join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
        join erp.account a on a.code = jl.account_code
        where a.type in ('income', 'expense')
        group by j.period_code order by j.period_code
      `)
    ).rows as { period_code: string; pl_minor: string }[];
    const complete = results.filter((r) => r.period_code < currentMonth);
    const latest = complete.at(-1) ?? null;
    const prior = complete.at(-2) ?? null;
    const toDate = results.find((r) => r.period_code === currentMonth) ?? null;

    // open items: AR overdue, AP due soon vs overdue
    const [ar] = (
      await db.execute(sql`
        select coalesce(sum(gross_minor), 0)::bigint as open,
               coalesce(sum(gross_minor) filter (where due_date < ${today}::date), 0)::bigint as overdue
        from erp.ar_invoice where status <> 'paid'
      `)
    ).rows as { open: string; overdue: string }[];
    const [ap] = (
      await db.execute(sql`
        select coalesce(sum(gross_minor), 0)::bigint as open,
               coalesce(sum(gross_minor) filter (where due_date < ${today}::date), 0)::bigint as overdue,
               coalesce(sum(gross_minor) filter (where due_date >= ${today}::date and due_date < ${today}::date + 7), 0)::bigint as due7
        from erp.ap_invoice where status not in ('paid', 'rejected') and book <> 'test'
      `)
    ).rows as { open: string; overdue: string; due7: string }[];

    // motion: what happened TODAY + the standing straight-through rate
    const [motion] = (
      await db.execute(sql`
        select
          (select count(*)::int from erp.ap_invoice where created_at::date = ${today}::date and book <> 'test') as invoices_today,
          (select count(*)::int from erp.ap_invoice where status = 'exception' and book <> 'test') as exceptions_open,
          (select count(*)::int from evidence."case" where created_at::date = ${today}::date) as cases_today,
          (select count(*)::int from erp.ap_invoice where book <> 'test' and status <> 'rejected') as inv_all,
          (select count(*)::int from erp.ap_invoice where book <> 'test' and status <> 'rejected' and exception_code is null and case_id is null) as inv_clean
      `)
    ).rows as { invoices_today: number; exceptions_open: number; cases_today: number; inv_all: number; inv_clean: number }[];

    // agents with a pulse: working now, queue depth, runs today, last action
    const agents = (
      await db.execute(sql`
        select a.slug, a.name,
          (select count(*)::int from agent.work_item w where w.agent_id = a.id and w.status in ('claimed', 'running')) as working,
          (select count(*)::int from agent.work_item w where w.agent_id = a.id and w.status = 'pending') as queued,
          (select count(*)::int from agent.agent_run r where r.agent_id = a.id and r.started_at::date = ${today}::date) as runs_today,
          (select r.result_summary from agent.agent_run r where r.agent_id = a.id order by r.started_at desc limit 1) as last_summary,
          (select to_char(r.started_at, 'HH24:MI') from agent.agent_run r where r.agent_id = a.id order by r.started_at desc limit 1) as last_at
        from agent.agent a
        where a.status = 'active'
        order by working desc, runs_today desc, a.name
      `)
    ).rows as { slug: string; name: string; working: number; queued: number; runs_today: number; last_summary: string | null; last_at: string | null }[];

    return {
      cash: {
        nowMinor: Number(cashRows.at(-1)?.balance_minor ?? 0),
        series: cashRows.map((r) => ({ date: r.txn_date, balanceMinor: Number(r.balance_minor) })),
      },
      result: {
        period: latest?.period_code ?? null,
        // ledger sign is debit-positive; profit = -(P&L sum)
        thisMinor: latest ? -Number(latest.pl_minor) : null,
        priorMinor: prior ? -Number(prior.pl_minor) : null,
        toDatePeriod: toDate ? currentMonth : null,
        toDateMinor: toDate ? -Number(toDate.pl_minor) : null,
      },
      ar: { openMinor: Number(ar?.open ?? 0), overdueMinor: Number(ar?.overdue ?? 0) },
      ap: { openMinor: Number(ap?.open ?? 0), overdueMinor: Number(ap?.overdue ?? 0), due7Minor: Number(ap?.due7 ?? 0) },
      motion: {
        invoicesToday: motion?.invoices_today ?? 0,
        exceptionsOpen: motion?.exceptions_open ?? 0,
        casesRaisedToday: motion?.cases_today ?? 0,
        straightThroughPct: motion && motion.inv_all > 0 ? Math.round((motion.inv_clean / motion.inv_all) * 100) : null,
      },
      agents,
    };
  });
}
