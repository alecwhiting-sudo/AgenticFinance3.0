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

  /** Cross-process dashboard (MASTER_PLAN Phase 6: "the finance function at
   * a glance"): one payload with a lane per process family — where work sits
   * in each pipe, what is stuck, and what waits on a human — plus a controls
   * strip. Counts over prose; every figure is derived and book-filtered, and
   * every row on the page links to the queue it counts. */
  app.get("/dashboard/processes", async () => {
    const db = requireDb();
    const today = new Date().toISOString().slice(0, 10);
    const currentMonth = today.slice(0, 7);
    const FRAUD = ["bank_detail_change", "bank_detail_mismatch"];

    // --- P2P: the invoice funnel + purchases feeding it + payments leaving it
    const invStages = (
      await db.execute(sql`
        select status, count(*)::int as n, coalesce(sum(gross_minor), 0)::bigint as total
        from erp.ap_invoice where book <> 'test' and status <> 'rejected'
        group by status
      `)
    ).rows as { status: string; n: number; total: string }[];
    const [p2pAgg] = (
      await db.execute(sql`
        select
          (select count(*)::int from erp.purchase where book <> 'test' and status = 'requested') as pos_awaiting,
          (select count(*)::int from erp.purchase where book <> 'test' and status in ('approved', 'partially_received')) as pos_open,
          (select count(*)::int from erp.ap_invoice where book <> 'test' and status = 'exception' and exception_code in (${sql.join(FRAUD.map((f) => sql`${f}`), sql`, `)})) as fraud_n,
          (select coalesce(sum(gross_minor), 0)::bigint from erp.ap_invoice where book <> 'test' and status = 'exception' and exception_code in (${sql.join(FRAUD.map((f) => sql`${f}`), sql`, `)})) as fraud_total,
          (select coalesce(sum(gross_minor), 0)::bigint from erp.ap_invoice where book <> 'test' and status not in ('paid', 'rejected') and due_date < ${today}::date) as ap_overdue,
          (select count(*)::int from erp.ap_payment where status = 'proposed') as pay_proposed_n,
          (select coalesce(sum(total_minor), 0)::bigint from erp.ap_payment where status = 'proposed') as pay_proposed_total,
          (select count(*)::int from erp.ap_payment where status in ('executed', 'reconciled') and run_date >= ${currentMonth + "-01"}::date) as pay_month_n,
          (select coalesce(sum(total_minor), 0)::bigint from erp.ap_payment where status in ('executed', 'reconciled') and run_date >= ${currentMonth + "-01"}::date) as pay_month_total
      `)
    ).rows as {
      pos_awaiting: number; pos_open: number; fraud_n: number; fraud_total: string;
      ap_overdue: string; pay_proposed_n: number; pay_proposed_total: string;
      pay_month_n: number; pay_month_total: string;
    }[];

    // --- O2C: receivables out, cash in, and the humans-needed queues
    const [o2c] = (
      await db.execute(sql`
        select
          (select count(*)::int from erp.ar_invoice where status <> 'paid') as ar_open_n,
          (select coalesce(sum(gross_minor), 0)::bigint from erp.ar_invoice where status <> 'paid') as ar_open_total,
          (select count(*)::int from erp.ar_invoice where status <> 'paid' and due_date < ${today}::date) as ar_overdue_n,
          (select coalesce(sum(gross_minor), 0)::bigint from erp.ar_invoice where status <> 'paid' and due_date < ${today}::date) as ar_overdue_total,
          (select count(*)::int from erp.bank_transaction where kind = 'ar_receipt' and status = 'unmatched') as rcpt_unmatched_n,
          (select coalesce(sum(amount_minor), 0)::bigint from erp.bank_transaction where kind = 'ar_receipt' and status = 'unmatched') as rcpt_unmatched_total,
          (select coalesce(sum(amount_minor), 0)::bigint from erp.bank_transaction where kind = 'ar_receipt' and status = 'matched' and txn_date >= ${currentMonth + "-01"}::date) as rcpt_month_total,
          (select count(*)::int from evidence."case" where kind = 'ar_receipt' and status in ('open', 'waiting_approval', 'escalated')) as receipt_queries,
          (select count(*)::int from evidence."case" where kind = 'ar_dispute' and status in ('open', 'waiting_approval', 'escalated')) as disputes,
          (select count(*)::int from erp.ar_dunning where created_at >= ${currentMonth + "-01"}::date) as dunning_month
      `)
    ).rows as {
      ar_open_n: number; ar_open_total: string; ar_overdue_n: number; ar_overdue_total: string;
      rcpt_unmatched_n: number; rcpt_unmatched_total: string; rcpt_month_total: string;
      receipt_queries: number; disputes: number; dunning_month: number;
    }[];

    // --- R2R: the latest complete month's close health
    const [latestRow] = (
      await db.execute(sql`
        select max(period_code) filter (where period_code < ${currentMonth}) as period
        from erp.journal where book <> 'test'
      `)
    ).rows as { period: string | null }[];
    const closePeriod = latestRow?.period ?? null;
    const [r2r] = closePeriod
      ? ((
          await db.execute(sql`
            select
              (select count(*)::int from erp.journal where book <> 'test' and period_code = ${closePeriod}) as journals,
              (select -coalesce(sum(jl.amount_minor), 0)::bigint
                 from erp.journal_line jl
                 join erp.journal j on j.id = jl.journal_id and j.book <> 'test' and j.period_code = ${closePeriod}
                 join erp.account a on a.code = jl.account_code and a.type in ('income', 'expense')) as result,
              (select count(*)::int from fdp.event where event_type = 'period.tick' and object_id = ${closePeriod}) as ticks,
              (select count(*)::int from fdp.event where status = 'failed' and book <> 'test') as failed_events
          `)
        ).rows as { journals: number; result: string; ticks: number; failed_events: number }[])
      : [undefined];
    const [bankRec] = (
      await db.execute(sql`
        select count(*)::int as total, count(*) filter (where status = 'matched')::int as matched
        from erp.bank_transaction
      `)
    ).rows as { total: number; matched: number }[];
    const pack = closePeriod
      ? await db.query.boardPack.findFirst({
          where: (t, { and, eq: e, ne }) => and(ne(t.book, "test"), e(t.periodTo, closePeriod)),
          orderBy: (t, { desc: d }) => d(t.createdAt),
          columns: { id: true, status: true, label: true },
        })
      : undefined;

    // --- Controls strip: everything waiting on a HUMAN, plus agent assurance
    const [controls] = (
      await db.execute(sql`
        select
          (select count(*)::int from agent.command where book <> 'test' and status = 'proposed' and requires_approval) as approvals,
          (select count(*)::int from evidence.mail_message where status = 'draft') as mail_drafts,
          (select count(*)::int from erp.ap_invoice where book <> 'test' and status <> 'rejected') as inv_all,
          (select count(*)::int from erp.ap_invoice where book <> 'test' and status <> 'rejected' and exception_code is null and case_id is null) as inv_clean
      `)
    ).rows as { approvals: number; mail_drafts: number; inv_all: number; inv_clean: number }[];
    // agent assurance: each active agent's LATEST finished eval suite
    const evals = (
      await db.execute(sql`
        select a.slug, er.status
        from agent.agent a
        left join lateral (
          select status from agent.eval_run where agent_id = a.id and status <> 'running'
          order by started_at desc limit 1
        ) er on true
        where a.status = 'active'
      `)
    ).rows as { slug: string; status: string | null }[];
    const graded = evals.filter((e) => e.status != null);

    const stage = (s: string) => {
      const r = invStages.find((x) => x.status === s);
      return { n: r?.n ?? 0, totalMinor: Number(r?.total ?? 0) };
    };
    return {
      p2p: {
        posAwaitingApproval: p2pAgg?.pos_awaiting ?? 0,
        posOpen: p2pAgg?.pos_open ?? 0,
        invoices: {
          captured: stage("captured"),
          matched: stage("matched"),
          exception: stage("exception"),
          approved: stage("approved"),
          posted: stage("posted"),
          scheduled: stage("scheduled"),
          paid: stage("paid"),
        },
        fraudHolds: { n: p2pAgg?.fraud_n ?? 0, totalMinor: Number(p2pAgg?.fraud_total ?? 0) },
        apOverdueMinor: Number(p2pAgg?.ap_overdue ?? 0),
        paymentsProposed: { n: p2pAgg?.pay_proposed_n ?? 0, totalMinor: Number(p2pAgg?.pay_proposed_total ?? 0) },
        paidThisMonth: { n: p2pAgg?.pay_month_n ?? 0, totalMinor: Number(p2pAgg?.pay_month_total ?? 0) },
      },
      o2c: {
        arOpen: { n: o2c?.ar_open_n ?? 0, totalMinor: Number(o2c?.ar_open_total ?? 0) },
        arOverdue: { n: o2c?.ar_overdue_n ?? 0, totalMinor: Number(o2c?.ar_overdue_total ?? 0) },
        receiptsUnapplied: { n: o2c?.rcpt_unmatched_n ?? 0, totalMinor: Number(o2c?.rcpt_unmatched_total ?? 0) },
        receiptsThisMonthMinor: Number(o2c?.rcpt_month_total ?? 0),
        receiptQueries: o2c?.receipt_queries ?? 0,
        disputes: o2c?.disputes ?? 0,
        dunningThisMonth: o2c?.dunning_month ?? 0,
      },
      r2r: {
        period: closePeriod,
        journals: r2r?.journals ?? 0,
        resultMinor: r2r ? Number(r2r.result) : null,
        periodTicked: (r2r?.ticks ?? 0) > 0,
        failedEvents: r2r?.failed_events ?? 0,
        bankRec: { matched: bankRec?.matched ?? 0, total: bankRec?.total ?? 0 },
        boardPack: pack ? { id: pack.id, status: pack.status, label: pack.label } : null,
      },
      controls: {
        approvalsPending: controls?.approvals ?? 0,
        mailDrafts: controls?.mail_drafts ?? 0,
        straightThroughPct:
          controls && controls.inv_all > 0 ? Math.round((controls.inv_clean / controls.inv_all) * 100) : null,
        agentsGreen: graded.filter((e) => e.status === "passed").length,
        agentsGraded: graded.length,
        agentsActive: evals.length,
      },
    };
  });
}
