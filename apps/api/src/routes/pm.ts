import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { activatePlanVersion, buildMechanicalForecast } from "../services/pm.js";

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
