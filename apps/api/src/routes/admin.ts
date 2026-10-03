import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { datasetMonthTotals, loadDemoDataset, truncateTransactions } from "../services/datasetLoader.js";

/** Admin panel backend (demo control room — not part of the finance product).
 * Reset/reload the demo data, replay it live from zero, process it month by
 * month, and host the drip controls. Finished runs are remembered in memory
 * for the pipeline dashboard's side-by-side (plans/DEMO_SCRIPTS.md §1; the
 * memory does not survive a container restart — fine for a demo). */

type Job = {
  running: boolean;
  mode: string;
  done: number;
  total: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};
const job: Job = { running: false, mode: "", done: 0, total: 0, message: "", startedAt: null, finishedAt: null, error: null };

export type RunRecord = {
  label: string;
  mode: string;
  startedAt: string;
  finishedAt: string;
  ms: number;
  items: number;
  monthLoaded: string | null;
  journals: number;
  balance: number;
  stats: Record<string, number>;
};
const runs: RunRecord[] = []; // newest first, capped

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const jobWithElapsed = () => ({
  ...job,
  elapsedMs: job.startedAt
    ? new Date(job.finishedAt ?? new Date().toISOString()).getTime() - new Date(job.startedAt).getTime()
    : 0,
});

export function adminRoutes(app: FastifyInstance): void {
  app.get("/admin/status", async () => {
    const db = requireDb();
    const [counts] = (
      await db.execute(sql`
        select (select count(*)::int from erp.purchase) as purchases,
               (select count(*)::int from erp.ap_invoice) as invoices,
               (select count(*)::int from erp.journal) as journals,
               (select count(*)::int from fdp.event) as events,
               (select count(*)::int from erp.bank_transaction) as bank_lines,
               (select coalesce(sum(amount_minor),0)::bigint from erp.journal_line) as balance
      `)
    ).rows;
    return { counts, job: jobWithElapsed() };
  });

  /** The mission-control feed (plans/DEMO_SCRIPTS.md §4): dataset backlog vs
   * loaded per month, the control split, integrity, job state, past runs. */
  app.get("/admin/pipeline", async () => {
    const db = requireDb();
    const datasetMonths = datasetMonthTotals();
    const loaded = (
      await db.execute(sql`
        select m, sum(ap)::int as ap, sum(ar)::int as ar, sum(bank)::int as bank from (
          select to_char(invoice_date,'YYYY-MM') as m, count(*) as ap, 0 as ar, 0 as bank from erp.ap_invoice group by 1
          union all
          select to_char(invoice_date,'YYYY-MM'), 0, count(*), 0 from erp.ar_invoice group by 1
          union all
          select to_char(txn_date,'YYYY-MM'), 0, 0, count(*) from erp.bank_transaction group by 1
        ) t group by m
      `)
    ).rows as { m: string; ap: number; ar: number; bank: number }[];
    const loadedBy = new Map(loaded.map((r) => [r.m, r]));
    const months = datasetMonths.map((d) => {
      const l = loadedBy.get(d.month);
      return {
        month: d.month,
        dataset: { ap: d.ap, ar: d.ar, bank: d.bank, total: d.ap + d.ar + d.bank },
        loaded: { ap: l?.ap ?? 0, ar: l?.ar ?? 0, bank: l?.bank ?? 0, total: (l?.ap ?? 0) + (l?.ar ?? 0) + (l?.bank ?? 0) },
      };
    });
    const [split] = (
      await db.execute(sql`
        select
          (select count(*)::int from erp.ap_invoice where status in ('matched','approved','posted','scheduled','paid')) as ap_straight,
          (select count(*)::int from erp.ap_invoice where status = 'exception') as ap_exceptions,
          (select count(*)::int from erp.ar_invoice) as ar_posted,
          (select count(*)::int from erp.bank_transaction where status = 'matched') as bank_matched,
          (select count(*)::int from erp.bank_transaction where status = 'unmatched') as bank_unmatched,
          (select count(*)::int from agent.work_item where status in ('pending','claimed','running')) as agent_queue,
          (select count(*)::int from agent.command where status = 'proposed' and requires_approval) as awaiting_human
      `)
    ).rows;
    const [integrity] = (
      await db.execute(sql`
        select (select count(*)::int from erp.journal) as journals,
               (select count(*)::int from fdp.event) as events,
               (select coalesce(sum(amount_minor),0)::bigint from erp.journal_line) as balance
      `)
    ).rows;
    // which month "Process next month" would load (mirrors the loader's boundary)
    const lastLoaded = months.filter((m) => m.loaded.total > 0).map((m) => m.month).pop() ?? null;
    const nextMonth = months.find((m) => !lastLoaded || m.month > lastLoaded)?.month ?? null;
    // model spend today — the loader runs are deterministic (0 model calls);
    // only agent runs (drips, exceptions, commentary, evals) appear here
    const spendRows = (
      await db.execute(sql`
        select rel.model_profile, count(*)::int as runs,
               coalesce(sum(r.input_tokens),0)::bigint as tin,
               coalesce(sum(r.output_tokens),0)::bigint as tout
        from agent.agent_run r join agent.agent_release rel on rel.id = r.release_id
        where r.started_at::date = current_date
        group by rel.model_profile
      `)
    ).rows as { model_profile: string; runs: number; tin: string; tout: string }[];
    const { estimateCostCents } = await import("../services/rateCard.js");
    const modelSpend = spendRows.reduce(
      (acc, r) => ({
        runs: acc.runs + r.runs,
        tokens: acc.tokens + Number(r.tin) + Number(r.tout),
        costCents: acc.costCents + estimateCostCents(r.model_profile, Number(r.tin), Number(r.tout)),
      }),
      { runs: 0, tokens: 0, costCents: 0 },
    );
    const recent = (
      await db.execute(sql`
        select at, summary from agent.activity_event order by seq desc limit 8
      `)
    ).rows as { at: string; summary: string }[];
    return { months, split, integrity, nextMonth, modelSpend, recent, job: jobWithElapsed(), runs };
  });

  /** mode: "reload" (instant full), "zero" (truncate only), "replay" (full
   * from zero; paceMs 0 = flat out, timed), "month" (incremental: next
   * unloaded month), "months" (all remaining months, pausing at each
   * boundary). Optional label names the run in the dashboard history. */
  app.post<{ Body: { mode?: string; paceMs?: number; label?: string } }>("/admin/reset", async (req, reply) => {
    const db = requireDb();
    const mode = req.body?.mode ?? "reload";
    if (!["reload", "zero", "replay", "month", "months", "cold", "cold-all"].includes(mode))
      return reply.code(400).send({ error: "mode must be reload | zero | replay | month | months | cold | cold-all" });
    if (job.running) return reply.code(409).send({ error: `a ${job.mode} job is already running` });

    job.running = true;
    job.mode = mode;
    job.done = 0;
    job.total = 0;
    job.message = "starting";
    job.startedAt = new Date().toISOString();
    job.finishedAt = null;
    job.error = null;

    const work = async () => {
      const paceMs = Math.min(Math.max(Number(req.body?.paceMs ?? (mode === "replay" ? 120 : 0)), 0), 2000);
      const record = (label: string, startedAt: string, items: number, result: { stats: Record<string, number>; journals: number; balance: number; monthLoaded?: string | null }) => {
        const finishedAt = new Date().toISOString();
        runs.unshift({
          label,
          mode,
          startedAt,
          finishedAt,
          ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
          items,
          monthLoaded: result.monthLoaded ?? null,
          journals: result.journals,
          balance: result.balance,
          stats: result.stats,
        });
        if (runs.length > 12) runs.pop();
      };
      try {
        if (mode === "zero") {
          await truncateTransactions(db);
          job.message = "all transaction data cleared — the books are empty";
        } else if (mode === "month" || mode === "months" || mode === "cold") {
          // one month per pass; "months" keeps going with a pause at each
          // boundary; "cold" queues the month's supplier invoices for the
          // extraction agent instead of posting them (real model work)
          for (;;) {
            const startedAt = new Date().toISOString();
            job.done = 0;
            job.total = 0;
            const result = await loadDemoDataset(db, {
              nextMonthOnly: true,
              coldStart: mode === "cold",
              paceMs,
              onProgress: (done, total, message) => {
                job.done = done;
                job.total = total;
                job.message = message;
              },
            });
            if (result.skipped) {
              job.message = result.reason ?? "nothing to do";
              break;
            }
            record(
              req.body?.label?.slice(0, 60) ?? `${mode === "cold" ? "cold start" : "month"} ${result.monthLoaded}`,
              startedAt,
              job.done,
              result,
            );
            job.message =
              mode === "cold"
                ? `${result.monthLoaded}: ${result.stats.queued ?? 0} supplier invoices queued for the agents — watch the queue drain`
                : `loaded ${result.monthLoaded} — ${result.journals} journals, balance ${result.balance}`;
            if (mode !== "months") break;
            job.message = `${result.monthLoaded} in the books — pausing at the month boundary`;
            await sleep(4000);
          }
        } else {
          const startedAt = new Date().toISOString();
          const result = await loadDemoDataset(db, {
            reset: true,
            coldStart: mode === "cold-all",
            paceMs,
            onProgress: (done, total, message) => {
              job.done = done;
              job.total = total;
              job.message = message;
            },
          });
          if (result.skipped) {
            job.message = "nothing to do";
          } else {
            job.message =
              mode === "cold-all"
                ? `${result.stats.queued ?? 0} supplier invoices queued for the agents — watch the queue drain`
                : `loaded — ${result.journals} journals, balance ${result.balance}`;
            record(
              req.body?.label?.slice(0, 60) ??
                (mode === "cold-all" ? "cold start — everything" : `${mode}${mode === "replay" && paceMs === 0 ? " (full speed)" : ""}`),
              startedAt,
              job.done,
              result,
            );
          }
        }
        await emitActivity({
          actorType: "human",
          actorId: "admin",
          verb: "reset_demo_data",
          objectType: "dataset",
          objectId: mode,
          summary:
            mode === "zero"
              ? "Demo data cleared — books at zero"
              : mode === "replay"
                ? "Demo dataset replayed from zero"
                : mode === "reload"
                  ? "Demo dataset reset and reloaded"
                  : `Demo data: ${job.message}`,
        });
      } catch (err) {
        job.error = String(err);
        job.message = "failed";
      } finally {
        job.running = false;
        job.finishedAt = job.finishedAt ?? new Date().toISOString();
      }
    };

    if (mode !== "reload" && mode !== "zero") {
      // potentially long-running: fire and forget; the UI polls /admin/status
      void work();
      return { started: true, mode };
    }
    await work();
    return { started: true, mode, job };
  });

  /** Scenario C (plans/DEMO_SCRIPTS.md §3): one believable morning's inbox —
   * a clean e-invoice, a scanned PDF, one exception, and (when an unapplied
   * receipt exists) a cash-application investigation. */
  app.post("/admin/simulate-day", async (_req, reply) => {
    const db = requireDb();
    const exceptionPool = ["price_variance", "qty_short_receipt", "missing_receipt", "no_purchase", "bank_detail_change"];
    const scenarios = ["clean", "scan_document", exceptionPool[Math.floor(Math.random() * exceptionPool.length)]!];
    const dripped: { scenario: string; summary: string }[] = [];
    for (const scenario of scenarios) {
      const res = await app.inject({ method: "POST", url: "/p2p/drip", payload: { scenario } });
      const body = res.json() as { supplier?: string; invoiceNumber?: string; error?: string };
      dripped.push({
        scenario,
        summary: res.statusCode === 200 ? `${body.supplier} ${body.invoiceNumber}` : `skipped: ${body.error}`,
      });
    }
    let receipt: string | null = null;
    const txn = await db.query.bankTransaction.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.status, "unmatched"), e(t.kind, "ar_receipt")),
    });
    if (txn) {
      const res = await app.inject({ method: "POST", url: "/o2c/investigate-receipt", payload: { bankTransactionId: txn.id } });
      receipt = res.statusCode === 200 ? txn.reference : null;
    }
    await emitActivity({
      actorType: "human",
      actorId: "demo-drip",
      verb: "simulated_day",
      objectType: "dataset",
      objectId: "day",
      summary: `Simulated a morning: ${dripped.length} invoices landed${receipt ? `, receipt ${receipt} under investigation` : ""}`,
    });
    return reply.send({ dripped, receipt });
  });

  /** Flush agent history to keep the demo cheap (D14): strip run transcripts
   * older than 30 days, prune eval_run rows older than 90 days (their
   * eval_summary rollups survive), and prune old activity events. Economic
   * data (events, movements, journals) is never touched here. */
  app.post("/admin/flush-history", async () => {
    const db = requireDb();
    const [{ n: transcripts }] = (
      await db.execute(sql`
        with u as (
          update agent.agent_run set transcript = '[]'::jsonb
          where started_at < now() - interval '30 days' and transcript <> '[]'::jsonb
          returning 1)
        select count(*)::int as n from u
      `)
    ).rows as { n: number }[];
    const [{ n: evalRuns }] = (
      await db.execute(sql`
        with d as (
          delete from agent.eval_run where started_at < now() - interval '90 days' returning 1)
        select count(*)::int as n from d
      `)
    ).rows as { n: number }[];
    const [{ n: activity }] = (
      await db.execute(sql`
        with d as (
          delete from agent.activity_event where at < now() - interval '30 days' returning 1)
        select count(*)::int as n from d
      `)
    ).rows as { n: number }[];
    await emitActivity({
      actorType: "human",
      actorId: "admin",
      verb: "flushed_history",
      objectType: "dataset",
      objectId: "history",
      summary: `History flush: ${transcripts} transcripts stripped, ${evalRuns} old eval runs pruned (summaries kept), ${activity} activity events pruned`,
    });
    return { transcripts, evalRuns, activity };
  });

}
