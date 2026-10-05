import type { FastifyInstance } from "fastify";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { boardPack, reportCommentary, workItem } from "@af/db";
import { parsePeriodLens } from "@af/shared";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { TEST_BOOK } from "../lib/bookContext.js";

/** R2R reporting + month-end dashboard (plans/R2R.md §4). Everything here
 * is derived aggregation over journal lines — never alternative measurement
 * logic. Reports state their basis: all LIVE until LRS lands. */
export function r2rRoutes(app: FastifyInstance): void {
  /** Monthly P&L + balance sheet for a year. P&L rows are month movements;
   * BS rows are cumulative balances at each month end (incl. prior years).
   * Sign convention: debit positive — the UI flips income/liability/equity
   * for display. */
  app.get<{ Querystring: { year?: string; from?: string; to?: string } }>("/erp/statements", async (req) => {
    const db = requireDb();
    const year = /^\d{4}$/.test(req.query.year ?? "") ? Number(req.query.year) : new Date().getUTCFullYear();
    // period-lens window (PR-B): from/to month codes narrow the statement to
    // that window; without them the whole year shows, as before
    const MONTH = /^\d{4}-\d{2}$/;
    const from = MONTH.test(req.query.from ?? "") ? req.query.from! : `${year}-01`;
    const to = MONTH.test(req.query.to ?? "") ? req.query.to! : `${year}-12`;

    const months = (
      await db.execute(sql`
        select distinct period_code from erp.journal
        where book <> 'test' and period_code >= ${from} and period_code <= ${to} order by 1
      `)
    ).rows.map((r) => (r as { period_code: string }).period_code);
    // every period with postings, unfiltered — the period picker's options
    const periods = (
      await db.execute(sql`select distinct period_code from erp.journal where book <> 'test' order by 1`)
    ).rows.map((r) => (r as { period_code: string }).period_code);

    const pl = (
      await db.execute(sql`
        select a.code, a.name, a.type, j.period_code, sum(jl.amount_minor)::bigint as amount_minor
        from erp.journal_line jl
        join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
        join erp.account a on a.code = jl.account_code
        where a.type in ('income', 'expense') and j.period_code >= ${from} and j.period_code <= ${to}
        group by a.code, a.name, a.type, j.period_code
        order by a.code
      `)
    ).rows as { code: string; name: string; type: string; period_code: string; amount_minor: string }[];

    // balance sheet: cumulative balance per account at each month end
    const bs = (
      await db.execute(sql`
        with monthly as (
          select a.code, a.name, a.type, j.period_code, sum(jl.amount_minor)::bigint as amount_minor
          from erp.journal_line jl
          join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
          join erp.account a on a.code = jl.account_code
          where a.type in ('asset', 'liability', 'equity')
          group by a.code, a.name, a.type, j.period_code
        )
        select code, name, type, period_code,
               sum(amount_minor) over (partition by code order by period_code)::bigint as balance_minor
        from monthly order by code, period_code
      `)
    ).rows as { code: string; name: string; type: string; period_code: string; balance_minor: string }[];

    // cumulative P&L (profit for the year to date) to make the BS balance
    const plCum = (
      await db.execute(sql`
        with monthly as (
          select j.period_code, sum(jl.amount_minor)::bigint as amount_minor
          from erp.journal_line jl
          join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
          join erp.account a on a.code = jl.account_code
          where a.type in ('income', 'expense')
          group by j.period_code
        )
        select period_code, sum(amount_minor) over (order by period_code)::bigint as balance_minor
        from monthly order by period_code
      `)
    ).rows as { period_code: string; balance_minor: string }[];

    return {
      basis: "live",
      year,
      from,
      to,
      months,
      periods,
      pl: pl.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })),
      bs: bs
        .filter((r) => r.period_code <= to)
        .map((r) => ({ ...r, balance_minor: Number(r.balance_minor) })),
      plCumulative: plCum.map((r) => ({ ...r, balance_minor: Number(r.balance_minor) })),
    };
  });

  /** Month-end dashboard status (plans/R2R.md §4). */
  app.get<{ Querystring: { period?: string } }>("/r2r/status", async (req) => {
    const db = requireDb();
    const period =
      req.query.period && /^\d{4}-\d{2}$/.test(req.query.period)
        ? req.query.period
        : new Date().toISOString().slice(0, 7);

    const bank = (
      await db.execute(sql`
        select kind, status, count(*)::int as n, sum(amount_minor)::bigint as total
        from erp.bank_transaction group by kind, status order by kind, status
      `)
    ).rows;
    const monthEnd = (
      await db.execute(sql`
        select source_event_key, status from fdp.event
        where event_type = 'period.tick' and object_id = ${period}
        order by ingested_at_utc
      `)
    ).rows;
    const [{ n: openExceptions }] = (
      await db.execute(sql`select count(*)::int as n from erp.ap_invoice where status = 'exception' and book <> 'test'`)
    ).rows as { n: number }[];
    const [{ n: failedEvents }] = (
      await db.execute(sql`select count(*)::int as n from fdp.event where status = 'failed' and book <> 'test'`)
    ).rows as { n: number }[];
    const periods = (
      await db.execute(sql`select distinct period_code from erp.journal where book <> 'test' order by 1 desc limit 12`)
    ).rows.map((r) => (r as { period_code: string }).period_code);

    return { period, periods, bank, monthEnd, openExceptions, failedEvents };
  });

  /** ---- Board packs (plans/DATASET_V2.md PR-G) ---------------------------
   * The decision-ready finance pack for a chosen period-lens window. A
   * draft request creates a row (status 'drafting') and queues the Board
   * Reporting Agent; the row persists, so the user can leave the page and
   * the pack is waiting at /reports/board when they return. Book-filtered:
   * eval-run packs (test book) never appear here. */
  app.post<{ Body: { lens?: string } }>("/r2r/board-packs/draft", async (req, reply) => {
    const db = requireDb();
    const L = parsePeriodLens(req.body?.lens);
    if (!L) return reply.code(400).send({ error: "lens required: YYYY-MM, YYYY-Qn or ytd@YYYY-MM" });
    const agentRow = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "board-reporter") });
    if (!agentRow) return reply.code(409).send({ error: "board-reporter agent not seeded yet — redeploy/seed first" });
    const [pack] = await db
      .insert(boardPack)
      .values({
        lensGrain: L.grain,
        periodFrom: L.from,
        periodTo: L.to,
        label: L.label,
        title: `Board pack — ${L.label}`,
        status: "drafting",
      })
      .returning();
    const [wi] = await db
      .insert(workItem)
      .values({
        type: "board.pack",
        agentId: agentRow.id,
        payload: { packId: pack!.id, lens: { grain: L.grain, from: L.from, to: L.to, label: L.label } },
        priority: 4,
      })
      .returning();
    await db.update(boardPack).set({ workItemId: wi!.id }).where(eq(boardPack.id, pack!.id));
    await emitActivity({
      actorType: "human",
      actorId: "workbench",
      verb: "requested_board_pack",
      objectType: "board_pack",
      objectId: pack!.id,
      summary: `Board pack requested for ${L.label} — Board Reporting Agent drafting`,
    });
    return { packId: pack!.id, workItemId: wi!.id, label: L.label };
  });

  app.get("/r2r/board-packs", async () => {
    const db = requireDb();
    const rows = await db.query.boardPack.findMany({
      where: (t) => ne(t.book, TEST_BOOK),
      orderBy: (t) => desc(t.createdAt),
      limit: 50,
    });
    // a drafting pack whose work item has FINISHED without saving sections
    // (run failed/escalated) is surfaced as failed, never left stuck
    const pending = rows.filter((r) => r.status === "drafting" && r.workItemId);
    const failedIds = new Set<string>();
    for (const r of pending) {
      const wi = await db.query.workItem.findFirst({ where: (t) => eq(t.id, r.workItemId!) });
      if (wi && (wi.status === "completed" || wi.status === "escalated")) {
        failedIds.add(r.id);
        await db.update(boardPack).set({ status: "failed", updatedAt: new Date() }).where(eq(boardPack.id, r.id));
      }
    }
    return {
      packs: rows.map((r) => ({
        id: r.id,
        label: r.label,
        title: r.title,
        status: failedIds.has(r.id) ? "failed" : r.status,
        lensGrain: r.lensGrain,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        sections: r.sections.length,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/r2r/board-packs/:id", async (req, reply) => {
    const db = requireDb();
    const row = await db.query.boardPack.findFirst({
      where: (t) => and(eq(t.id, req.params.id), ne(t.book, TEST_BOOK)),
    });
    if (!row) return reply.code(404).send({ error: "board pack not found" });
    return { pack: row };
  });

  app.delete<{ Params: { id: string } }>("/r2r/board-packs/:id", async (req, reply) => {
    const db = requireDb();
    const row = await db.query.boardPack.findFirst({
      where: (t) => and(eq(t.id, req.params.id), ne(t.book, TEST_BOOK)),
    });
    if (!row) return reply.code(404).send({ error: "board pack not found" });
    await db.delete(boardPack).where(eq(boardPack.id, row.id));
    return { deleted: row.id };
  });

  /** Latest draft commentary across all periods (so the UI can find where
   * the most recent draft lives even when the displayed period moved on). */
  app.get("/r2r/commentary/latest", async () => {
    const db = requireDb();
    const row = await db.query.reportCommentary.findFirst({
      orderBy: (t) => desc(t.createdAt),
    });
    return { commentary: row ?? null };
  });

  /** Latest draft commentary for a period. */
  app.get<{ Querystring: { period?: string } }>("/r2r/commentary", async (req, reply) => {
    const db = requireDb();
    const period = req.query.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period))
      return reply.code(400).send({ error: "period (YYYY-MM) required" });
    const row = await db.query.reportCommentary.findFirst({
      where: (t) => eq(t.periodCode, period),
      orderBy: (t) => desc(t.createdAt),
    });
    return { commentary: row ?? null };
  });

  /** Ask the Close Agent to draft commentary for a period. The payload
   * carries the figures (this month vs prior, by account) so both the model
   * and the keyless fallback ground on real numbers — never invented. */
  app.post<{ Body: { periodCode: string } }>("/r2r/commentary/draft", async (req, reply) => {
    const db = requireDb();
    const periodCode = req.body?.periodCode;
    if (!periodCode || !/^\d{4}-\d{2}$/.test(periodCode))
      return reply.code(400).send({ error: "periodCode (YYYY-MM) required" });

    const figures = (
      await db.execute(sql`
        with monthly as (
          select a.code, a.name, a.type, j.period_code, sum(jl.amount_minor)::bigint as amount_minor
          from erp.journal_line jl
          join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
          join erp.account a on a.code = jl.account_code
          where a.type in ('income', 'expense')
          group by a.code, a.name, a.type, j.period_code
        )
        select code, name, type,
          coalesce(sum(amount_minor) filter (where period_code = ${periodCode}), 0)::bigint as this_minor,
          coalesce(sum(amount_minor) filter (where period_code = to_char((${periodCode} || '-01')::date - interval '1 month', 'YYYY-MM')), 0)::bigint as prev_minor
        from monthly group by code, name, type
        having coalesce(sum(amount_minor) filter (where period_code = ${periodCode}), 0) <> 0
            or coalesce(sum(amount_minor) filter (where period_code = to_char((${periodCode} || '-01')::date - interval '1 month', 'YYYY-MM')), 0) <> 0
        order by code
      `)
    ).rows as { code: string; name: string; type: string; this_minor: string; prev_minor: string }[];
    if (figures.length === 0) return reply.code(409).send({ error: `no activity in ${periodCode}` });

    const agentRow = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "close") });
    if (!agentRow) return reply.code(409).send({ error: "close agent not seeded" });
    const [wi] = await db
      .insert(workItem)
      .values({
        type: "r2r.commentary",
        agentId: agentRow.id,
        payload: {
          periodCode,
          figures: figures.map((f) => ({
            code: f.code,
            name: f.name,
            type: f.type,
            thisMinor: Number(f.this_minor),
            prevMinor: Number(f.prev_minor),
          })),
        },
        priority: 4,
      })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: "workbench",
      verb: "requested_commentary",
      objectType: "work_item",
      objectId: wi!.id,
      summary: `Close Agent asked to draft ${periodCode} flux commentary`,
    });
    return { workItemId: wi!.id };
  });
}
