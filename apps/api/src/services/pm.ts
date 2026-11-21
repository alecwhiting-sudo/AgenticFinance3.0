/** PM deterministic services (plans/PM.md §3, M2). Code decides — no model
 * call: the mechanical rolling forecast is arithmetic over posted actuals
 * and the active budget. The Forecast Preparation Agent (M3) starts from
 * this baseline and adjusts DRIVERS; it never replaces this maths. */
import { eq, sql } from "drizzle-orm";
import { driverSet, planLine, planVersion, type Db } from "@af/db";

/** Mechanical rolling forecast as of a period: months up to and including
 * the latest POSTED month carry actuals; later months carry budget × a
 * per-account run-rate factor (average actual/budget over the last three
 * complete months, clamped 0.6–1.4 so one odd month cannot run away).
 * Idempotent per asOf: re-drafting replaces the lines of a still-draft
 * FC-<asOf>; an activated one is never touched (409). */
/** Measure the books against the active budget: posted months, per-account
 * run-rate factors (avg actual/budget over the last 3 posted months,
 * clamped 0.6–1.4) and the raw maps. One source of truth for the forecast
 * builder, the agent's facts pack and the eval selector. */
export async function measureRunRates(db: Db, asOf: string) {
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
  const horizon = postedMonths.filter((m) => m <= lastPosted).slice(-3);
  const actualAt = new Map(actuals.map((a) => [`${a.account_code}:${a.period_code}`, Number(a.amt)]));
  const budgetAt = new Map(budgetLines.map((l) => [`${l.accountCode}:${l.periodCode}`, l.amountMinor]));

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
  return { budget, budgetLines, actualAt, budgetAt, factors, lastPosted, horizon, year };
}

export async function buildMechanicalForecast(
  db: Db,
  asOf: string,
  createdBy: string,
): Promise<{ version: typeof planVersion.$inferSelect; lines: number; factors: Record<string, number> }> {
  const { budget, budgetLines, actualAt, budgetAt, factors, lastPosted, horizon, year } = await measureRunRates(db, asOf);

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

  // FC-<asOf>; once that is adopted or superseded, successors take .2, .3 …
  // — an adopted version is immutable, a re-forecast is a NEW version.
  const siblings = await db.query.planVersion.findMany({
    where: (t, { like }) => like(t.code, `FC-${asOf}%`),
  });
  const draftSibling = siblings.find((s) => s.status === "draft");
  const code = draftSibling?.code ?? (siblings.length === 0 ? `FC-${asOf}` : `FC-${asOf}.${siblings.length + 1}`);
  const existing = draftSibling ?? null;

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
        notes: `Actuals through ${lastPosted}, then ${budget.code} adjusted by each account's recent run-rate.`,
        createdBy,
      })
      .returning();
    version = inserted[0]!;
  }
  if (lines.length > 0)
    await db.insert(planLine).values(lines.map((l) => ({ ...l, planVersionId: version.id })));
  return { version, lines: lines.length, factors };
}

/** The deterministic facts pack the Forecast Preparation Agent reasons
 * over (plans/PM.md M3) — same pattern as the release reviewer: the API
 * assembles measured facts, the agent writes judgement over them. */
export async function assembleForecastFacts(db: Db, asOf: string) {
  const { budgetLines, actualAt, factors, lastPosted, horizon } = await measureRunRates(db, asOf);
  const drivers = await db.query.driverSet.findFirst({
    where: (t, { eq }) => eq(t.status, "active"),
    orderBy: (t, { desc }) => desc(t.version),
  });
  const ytd: Record<string, { budgetMinor: number; actualMinor: number }> = {};
  for (const l of budgetLines) {
    if (l.periodCode > lastPosted) continue;
    const t = (ytd[l.accountCode] ??= { budgetMinor: 0, actualMinor: 0 });
    t.budgetMinor += l.amountMinor;
    t.actualMinor += actualAt.get(`${l.accountCode}:${l.periodCode}`) ?? 0;
  }
  const assumptions = { ...((drivers?.assumptions as Record<string, unknown>) ?? {}) };
  delete assumptions.workingDays; // bulk noise the agent never adjusts
  return { asOf, lastPosted, runRateWindow: horizon, runRates: factors, drivers: assumptions, ytd };
}

/** Save the Forecast Preparation Agent's draft (plans/PM.md M3, via the
 * epm.plan.save command): the agent names DRIVER changes with a reason
 * each; this recomputes the plan deterministically from the adjusted
 * assumptions — the agent never writes line amounts. Always a draft. */
export async function saveAgentForecast(
  db: Db,
  p: { asOf: string; driverDeltas: { driver: string; to: number; rationale: string }[]; commentary: string },
  actor: string,
): Promise<{ code: string; versionId: string; lines: number }> {
  const budget = await db.query.planVersion.findFirst({
    where: (t, { and, eq }) => and(eq(t.kind, "budget"), eq(t.status, "active")),
  });
  if (!budget) throw Object.assign(new Error("no active budget"), { statusCode: 409 });
  const activeDrivers = await db.query.driverSet.findFirst({
    where: (t, { eq }) => eq(t.status, "active"),
    orderBy: (t, { desc }) => desc(t.version),
  });
  if (!activeDrivers) throw Object.assign(new Error("no active driver set"), { statusCode: 409 });

  const assumptions = { ...(activeDrivers.assumptions as Record<string, unknown>) };
  for (const d of p.driverDeltas) {
    const cur = assumptions[d.driver];
    if (typeof cur !== "number")
      throw Object.assign(new Error(`unknown or non-numeric driver "${d.driver}" — drivers are the named assumptions`), { statusCode: 400 });
    // sanity rail: a forecast adjustment is a nudge, not a rewrite
    if (cur !== 0 && Math.abs(d.to - cur) / Math.abs(cur) > 0.5)
      throw Object.assign(new Error(`driver "${d.driver}" moved more than 50% (${cur} → ${d.to}) — outside forecast authority, escalate instead`), { statusCode: 400 });
    assumptions[d.driver] = d.to;
  }

  // the mechanical shape, but future months price from the ADJUSTED drivers
  const base = await buildMechanicalForecast(db, p.asOf, actor); // ensures FC-<asOf> draft exists & factors measured
  const year = p.asOf.slice(0, 4);
  const { buildBudgetLines } = await import("@af/db");
  const adjusted = buildBudgetLines(assumptions as unknown as Parameters<typeof buildBudgetLines>[0], Number(year));
  const adjustedAt = new Map(adjusted.map((l) => [`${l.accountCode}:${l.periodCode}`, l.amountMinor]));

  let dsId = activeDrivers.id;
  if (p.driverDeltas.length > 0) {
    const [maxRow] = (
      await db.execute(sql`select coalesce(max(version), 0)::int as v from epm.driver_set where code = ${activeDrivers.code}`)
    ).rows as { v: number }[];
    const [ds] = await db
      .insert(driverSet)
      .values({
        code: activeDrivers.code,
        version: (maxRow?.v ?? 0) + 1,
        label: `Forecast proposal drivers (as of ${p.asOf})`,
        assumptions,
        status: "draft",
        createdBy: actor,
      })
      .returning();
    dsId = ds!.id;
  }

  const notes = [
    p.commentary,
    ...p.driverDeltas.map((d) => `• ${d.driver} → ${d.to}: ${d.rationale}`),
  ].join("\n");
  // replace the mechanical draft's future months with adjusted-driver pricing
  const lines = await db.query.planLine.findMany({ where: (t, { eq }) => eq(t.planVersionId, base.version.id) });
  const lastActual = lines.filter((l) => l.note === "actual (posted)").map((l) => l.periodCode).sort().at(-1) ?? p.asOf;
  for (const l of lines) {
    if (l.periodCode > lastActual) {
      const adj = adjustedAt.get(`${l.accountCode}:${l.periodCode}`) ?? 0;
      const factor = base.factors[l.accountCode] ?? 1;
      const amt = Math.round((adj * factor) / 100) * 100;
      await db
        .update(planLine)
        .set({ amountMinor: amt, note: `adjusted drivers × ${factor.toFixed(2)} run-rate` })
        .where(eq(planLine.id, l.id));
    }
  }
  await db
    .update(planVersion)
    .set({
      label: `Rolling forecast as of ${p.asOf} (agent-prepared)`,
      notes,
      driverSetId: dsId,
      createdBy: actor,
    })
    .where(eq(planVersion.id, base.version.id));
  return { code: base.version.code, versionId: base.version.id, lines: lines.length };
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
