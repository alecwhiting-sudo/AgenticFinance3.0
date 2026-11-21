/** PM deterministic services (plans/PM.md §3, M2). Code decides — no model
 * call: the mechanical rolling forecast is arithmetic over posted actuals
 * and the active budget. The Forecast Preparation Agent (M3) starts from
 * this baseline and adjusts DRIVERS; it never replaces this maths. */
import { sql } from "drizzle-orm";
import { planLine, planVersion, type Db } from "@af/db";

/** Mechanical rolling forecast as of a period: months up to and including
 * the latest POSTED month carry actuals; later months carry budget × a
 * per-account run-rate factor (average actual/budget over the last three
 * complete months, clamped 0.6–1.4 so one odd month cannot run away).
 * Idempotent per asOf: re-drafting replaces the lines of a still-draft
 * FC-<asOf>; an activated one is never touched (409). */
export async function buildMechanicalForecast(
  db: Db,
  asOf: string,
  createdBy: string,
): Promise<{ version: typeof planVersion.$inferSelect; lines: number; factors: Record<string, number> }> {
  const budget = await db.query.planVersion.findFirst({
    where: (t, { and, eq }) => and(eq(t.kind, "budget"), eq(t.status, "active")),
  });
  if (!budget) throw Object.assign(new Error("no active budget"), { statusCode: 409 });

  const year = asOf.slice(0, 4);
  const actuals = (
    await db.execute(sql`
      select jl.account_code, j.period_code, sum(jl.amount_minor)::bigint as amt
      from erp.journal_line jl
      join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
      join erp.account a on a.code = jl.account_code and a.type in ('income', 'expense')
      where j.period_code <= ${asOf} and j.period_code >= ${year + "-01"}
      group by 1, 2
    `)
  ).rows as { account_code: string; period_code: string; amt: string }[];
  const budgetLines = await db.query.planLine.findMany({ where: (t, { eq }) => eq(t.planVersionId, budget.id) });

  const postedMonths = [...new Set(actuals.map((a) => a.period_code))].sort();
  const lastPosted = postedMonths.at(-1) ?? asOf;
  const horizon = postedMonths.filter((m) => m <= lastPosted).slice(-3); // run-rate window
  const actualAt = new Map(actuals.map((a) => [`${a.account_code}:${a.period_code}`, Number(a.amt)]));
  const budgetAt = new Map(budgetLines.map((l) => [`${l.accountCode}:${l.periodCode}`, l.amountMinor]));

  // per-account run-rate factor from the last three complete months
  const factors: Record<string, number> = {};
  for (const code of new Set(budgetLines.map((l) => l.accountCode))) {
    let a = 0;
    let b = 0;
    for (const m of horizon) {
      a += actualAt.get(`${code}:${m}`) ?? 0;
      b += budgetAt.get(`${code}:${m}`) ?? 0;
    }
    factors[code] = b !== 0 ? Math.min(1.4, Math.max(0.6, a / b)) : 1;
  }

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const lines = [] as { accountCode: string; periodCode: string; amountMinor: number; note: string }[];
  for (const code of new Set(budgetLines.map((l) => l.accountCode))) {
    for (const m of months) {
      if (m <= lastPosted) {
        const amt = actualAt.get(`${code}:${m}`) ?? 0;
        if (amt !== 0) lines.push({ accountCode: code, periodCode: m, amountMinor: amt, note: "actual (posted)" });
      } else {
        const base = budgetAt.get(`${code}:${m}`) ?? 0;
        const amt = Math.round((base * factors[code]!) / 100) * 100;
        if (amt !== 0)
          lines.push({
            accountCode: code,
            periodCode: m,
            amountMinor: amt,
            note: `budget × ${factors[code]!.toFixed(2)} run-rate (last ${horizon.length} posted months)`,
          });
      }
    }
  }

  const code = `FC-${asOf}`;
  const existing = await db.query.planVersion.findFirst({ where: (t, { eq }) => eq(t.code, code) });
  if (existing && existing.status !== "draft")
    throw Object.assign(new Error(`${code} is ${existing.status} — an adopted forecast is never rebuilt; draft a later one`), { statusCode: 409 });

  let version: typeof planVersion.$inferSelect;
  if (existing) {
    await db.execute(sql`delete from epm.plan_line where plan_version_id = ${existing.id}`);
    version = existing;
  } else {
    const inserted = await db
      .insert(planVersion)
      .values({
        kind: "forecast",
        code,
        label: `Rolling forecast as of ${asOf} (mechanical)`,
        status: "draft",
        driverSetId: budget.driverSetId,
        basedOnId: budget.id,
        notes: `Mechanical baseline: actuals through ${lastPosted}, then ${budget.code} × per-account run-rate (clamped 0.6–1.4). plans/PM.md M2.`,
        createdBy,
      })
      .returning();
    version = inserted[0]!;
  }
  if (lines.length > 0)
    await db.insert(planLine).values(lines.map((l) => ({ ...l, planVersionId: version.id })));
  return { version, lines: lines.length, factors };
}

/** The human adoption gate (plans/PM.md §5): draft → active, superseding
 * any previously active forecast. Agents never call this — it has no
 * command type; it exists only behind the workbench endpoint. */
export async function activatePlanVersion(
  db: Db,
  id: string,
  activatedBy: string,
): Promise<typeof planVersion.$inferSelect> {
  const v = await db.query.planVersion.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  if (!v) throw Object.assign(new Error("plan version not found"), { statusCode: 404 });
  if (v.kind === "budget") throw Object.assign(new Error("the budget is already governance-seeded — activate forecasts and scenarios"), { statusCode: 409 });
  if (v.status !== "draft") throw Object.assign(new Error(`version is ${v.status}, not draft`), { statusCode: 409 });
  await db.execute(sql`
    update epm.plan_version set status = 'superseded'
    where kind = ${v.kind} and status = 'active'
  `);
  await db.execute(sql`
    update epm.plan_version set status = 'active', activated_by = ${activatedBy}, activated_at = now()
    where id = ${v.id}
  `);
  return (await db.query.planVersion.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
}
