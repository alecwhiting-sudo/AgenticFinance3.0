import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { activatePlanVersion, assembleForecastFacts, buildMechanicalForecast, scenarioPreview } from "../services/pm.js";
import { workItem } from "@af/db";

/** Performance Management (plans/PM.md M1): actuals vs the ACTIVE budget.
 * Plans live in epm and are never journals; variance is a query joining
 * the two, book-filtered like every other read. Amounts come back signed
 * as posted (income negative) — the web flips for display as usual. */
export function pmRoutes(app: FastifyInstance): void {
  /** Budget vs actuals per account × period in [from, to]; defaults to the
   * year to the latest complete month. */
  app.get<{ Querystring: { from?: string; to?: string; vs?: string } }>("/pm/variance", async (req, reply) => {
    const db = requireDb();
    const ok = (s?: string) => !!s && /^\d{4}-\d{2}$/.test(s);
    // default window: the year to the latest month with postings — months
    // with budget but no books yet would only read as fake adverse variance
    const [latest] = (
      await db.execute(sql`select max(period_code) as p from erp.journal where book <> 'test'`)
    ).rows as { p: string | null }[];
    const to = ok(req.query.to) ? req.query.to! : (latest?.p ?? new Date().toISOString().slice(0, 7));
    const from = ok(req.query.from) ? req.query.from! : `${to.slice(0, 4)}-01`;
    if (from > to) return reply.code(400).send({ error: "from must not exceed to" });

    // compare against the active budget (default) or the active forecast
    const vsKind = req.query.vs === "forecast" ? "forecast" : "budget";
    const budget = await db.query.planVersion.findFirst({
      where: (t, { and, eq }) => and(eq(t.kind, vsKind), eq(t.status, "active")),
    });
    if (!budget)
      return reply.code(409).send({
        error: vsKind === "budget" ? "no active budget — seed/deploy first" : "no active forecast — draft and activate one first",
      });

    const rows = (
      await db.execute(sql`
        with actual as (
          select jl.account_code, j.period_code, sum(jl.amount_minor)::bigint as amt
          from erp.journal_line jl
          join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
          join erp.account a on a.code = jl.account_code and a.type in ('income', 'expense')
          where j.period_code between ${from} and ${to}
          group by 1, 2
        ),
        plan as (
          select account_code, period_code, sum(amount_minor)::bigint as amt
          from epm.plan_line
          where plan_version_id = ${budget.id} and period_code between ${from} and ${to}
          group by 1, 2
        )
        select coalesce(p.account_code, a.account_code) as account_code,
               coalesce(p.period_code, a.period_code) as period_code,
               coalesce(p.amt, 0)::bigint as budget_minor,
               coalesce(a.amt, 0)::bigint as actual_minor
        from plan p full outer join actual a
          on a.account_code = p.account_code and a.period_code = p.period_code
        order by 1, 2
      `)
    ).rows as { account_code: string; period_code: string; budget_minor: string; actual_minor: string }[];

    const accounts = (
      await db.execute(sql`select code, name, type from erp.account where type in ('income', 'expense') order by code`)
    ).rows as { code: string; name: string; type: string }[];

    return {
      budget: { id: budget.id, code: budget.code, label: budget.label, kind: vsKind },
      window: { from, to },
      accounts,
      cells: rows.map((r) => ({
        accountCode: r.account_code,
        periodCode: r.period_code,
        budgetMinor: Number(r.budget_minor),
        actualMinor: Number(r.actual_minor),
      })),
    };
  });

  /** Every plan version with its driver set — the planning audit trail. */
  app.get("/pm/versions", async () => {
    const db = requireDb();
    const versions = await db.query.planVersion.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) });
    const drivers = await db.query.driverSet.findMany({ orderBy: (t, { desc }) => desc(t.createdAt) });
    return { versions, drivers };
  });

  /** Draft the mechanical rolling forecast (plans/PM.md M2): deterministic,
   * idempotent per as-of month; always a DRAFT — adoption is the human
   * gate below. */
  app.post<{ Body: { asOf?: string } }>("/pm/forecast/draft", async (req, reply) => {
    const db = requireDb();
    const [latest] = (
      await db.execute(sql`select max(period_code) as p from erp.journal where book <> 'test'`)
    ).rows as { p: string | null }[];
    const asOf =
      req.body?.asOf && /^\d{4}-\d{2}$/.test(req.body.asOf) ? req.body.asOf : (latest?.p ?? new Date().toISOString().slice(0, 7));
    try {
      const r = await buildMechanicalForecast(db, asOf, "workbench-user");
      await emitActivity({
        actorType: "human",
        actorId: "workbench",
        verb: "drafted_forecast",
        objectType: "plan_version",
        objectId: r.version.id,
        summary: `${r.version.code} drafted (mechanical): actuals to date + budget × run-rate, ${r.lines} lines`,
      });
      return { version: r.version, lines: r.lines, factors: r.factors };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  /** Ask the Forecast Preparation Agent for a draft (plans/PM.md M3): the
   * API assembles the measured facts pack (run-rates, YTD vs budget, the
   * active drivers) and queues the agent, which proposes epm.plan.save —
   * a DRAFT with driver changes reasoned one by one. Adoption stays human. */
  app.post<{ Body: { asOf?: string } }>("/pm/forecast/prepare", async (req, reply) => {
    const db = requireDb();
    const agentRow = await db.query.agent.findFirst({ where: (t, { eq }) => eq(t.slug, "forecast-prep") });
    if (!agentRow) return reply.code(409).send({ error: "forecast-prep agent not seeded yet — redeploy first" });
    const [latest] = (
      await db.execute(sql`select max(period_code) as p from erp.journal where book <> 'test'`)
    ).rows as { p: string | null }[];
    const asOf =
      req.body?.asOf && /^\d{4}-\d{2}$/.test(req.body.asOf) ? req.body.asOf : (latest?.p ?? new Date().toISOString().slice(0, 7));
    try {
      const facts = await assembleForecastFacts(db, asOf);
      const [wi] = await db
        .insert(workItem)
        .values({
          type: "pm.forecast",
          agentId: agentRow.id,
          payload: {
            asOf,
            facts,
            objective:
              "Prepare the rolling forecast as of this month from the facts pack: start from the mechanical baseline, adjust DRIVERS only where the measured run-rates and YTD variances justify it (one written rationale per change, citing the figures), and propose exactly one epm.plan.save with your commentary. The result is a draft — a human adopts it; never attempt to activate.",
          },
          priority: 4,
        })
        .returning();
      await emitActivity({
        actorType: "human",
        actorId: "workbench",
        verb: "requested_forecast",
        objectType: "work_item",
        objectId: wi!.id,
        summary: `Forecast Preparation Agent asked to prepare the rolling forecast as of ${asOf}`,
      });
      return { workItemId: wi!.id, asOf };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  /** What-if (plans/PM.md M4): recompute the FY landing from adjusted
   * drivers — pure computation, nothing stored. With save.label it also
   * persists the scenario as a draft plan version for the record. */
  app.post<{ Body: { overrides?: Record<string, number>; saveLabel?: string } }>("/pm/scenario", async (req, reply) => {
    const db = requireDb();
    try {
      const r = await scenarioPreview(
        db,
        req.body?.overrides ?? {},
        req.body?.saveLabel?.trim() ? { label: req.body.saveLabel.trim().slice(0, 120), createdBy: "workbench-user" } : undefined,
      );
      if (r.savedCode)
        await emitActivity({
          actorType: "human",
          actorId: "workbench",
          verb: "saved_scenario",
          objectType: "plan_version",
          objectId: r.savedCode,
          summary: `Scenario ${r.savedCode} saved: ${Object.entries(r.changed).map(([k, c]) => `${k} ${c.from}→${c.to}`).join(", ") || "baseline"}`,
        });
      return r;
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  /** FY landing from the adopted forecast — the /pm KPI. */
  app.get("/pm/landing", async () => {
    const db = requireDb();
    const fc = await db.query.planVersion.findFirst({
      where: (t, { and, eq }) => and(eq(t.kind, "forecast"), eq(t.status, "active")),
    });
    if (!fc) return { landing: null };
    const lines = await db.query.planLine.findMany({ where: (t, { eq }) => eq(t.planVersionId, fc.id) });
    let revenue = 0;
    let total = 0;
    for (const l of lines) {
      if (l.accountCode.startsWith("4")) revenue += l.amountMinor;
      total += l.amountMinor;
    }
    return { landing: { code: fc.code, revenueMinor: -revenue, resultMinor: -total } };
  });

  /** The adoption gate: a HUMAN activates a draft; the previously active
   * version of that kind is superseded. No agent command reaches this. */
  app.post<{ Params: { id: string }; Body: { activatedBy?: string } }>(
    "/pm/versions/:id/activate",
    async (req, reply) => {
      const db = requireDb();
      try {
        const v = await activatePlanVersion(db, req.params.id, req.body?.activatedBy || "workbench-user");
        await emitActivity({
          actorType: "human",
          actorId: req.body?.activatedBy || "workbench",
          verb: "activated_plan",
          objectType: "plan_version",
          objectId: v.id,
          summary: `${v.code} adopted as the active ${v.kind} — actuals now track against it`,
        });
        return { version: v };
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        return reply.code(err.statusCode ?? 500).send({ error: err.message });
      }
    },
  );
}
