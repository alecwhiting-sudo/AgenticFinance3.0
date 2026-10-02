/** Month-end postings (plans/R2R.md §3): prepayment releases, accruals
 * (auto-reversing next period) and recurring journals, driven by the active
 * month-end parameter set. Each posting is a `period.tick` event WITHOUT
 * deltas — the derivation engine computes them — proving the
 * business-initiated posture end to end. Idempotent per (schedule, period):
 * re-running a month is a no-op. */
import { and, eq } from "drizzle-orm";
import { type Db } from "@af/db";
import { postEvent } from "./fdpPost.js";
import { periodEnd, type MonthEndSchedule } from "./fdpEngine.js";

export const MONTH_END_PARAMETER_SET = "month-end-schedules";

export async function activeSchedules(db: Db): Promise<{ id: string; schedules: MonthEndSchedule[] }> {
  const ps = await db.query.fdpParameterSet.findFirst({
    where: (t) => and(eq(t.name, MONTH_END_PARAMETER_SET), eq(t.status, "active")),
  });
  if (!ps) throw Object.assign(new Error("no active month-end parameter set"), { statusCode: 409 });
  const schedules = (ps.parameters.schedules ?? []) as MonthEndSchedule[];
  return { id: ps.id, schedules };
}

const prevPeriod = (periodCode: string): string => {
  const [y, m] = periodCode.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export async function runMonthEnd(
  db: Db,
  periodCode: string,
  postedBy = "month-end",
): Promise<{ posted: number; replayed: number; entries: string[] }> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) throw new Error("periodCode must be YYYY-MM");
  const { id: parameterSetId, schedules } = await activeSchedules(db);
  let posted = 0;
  let replayed = 0;
  const entries: string[] = [];

  const tick = async (
    schedule: MonthEndSchedule,
    occurredAt: string,
    sourceEventKey: string,
    reversal: boolean,
  ) => {
    const r = await postEvent(db, {
      eventType: "period.tick",
      occurredAt,
      sourceSystem: "api",
      sourceEventKey,
      objectType: "period",
      objectId: periodCode,
      details: { schedule, reversal, parameterSetId, periodCode },
      deltas: null, // the engine derives — second posture
      memo: `${reversal ? "Reversal: " : ""}${schedule.description} (${periodCode})`,
      postedBy,
      // several journals per period: source must be per-event, not per-object
      journalSource: { type: "period_tick", id: sourceEventKey },
    });
    r.replayed ? replayed++ : posted++;
    if (!r.replayed) entries.push(`${reversal ? "reversal " : ""}${schedule.key}`);
  };

  for (const s of schedules) {
    // reverse last period's accrual first (dated day 1 of this period)
    if (s.kind === "accrual") {
      const prev = prevPeriod(periodCode);
      const prevRan = await db.query.fdpEvent.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(e(t.sourceSystem, "api"), e(t.sourceEventKey, `period.tick:${s.key}:${prev}`)),
      });
      if (prevRan)
        await tick(s, `${periodCode}-01`, `period.tick:rev:${s.key}:${periodCode}`, true);
    }
    await tick(s, periodEnd(periodCode), `period.tick:${s.key}:${periodCode}`, false);
  }
  return { posted, replayed, entries };
}
