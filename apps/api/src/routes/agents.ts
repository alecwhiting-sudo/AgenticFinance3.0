import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agent,
  agentRelease,
  agentRun,
  evalCase,
  evalRun,
  skill,
  skillVersion,
  workItem,
} from "@af/db";
import {
  createReleaseSchema,
  createSkillVersionSchema,
  promoteReleaseSchema,
} from "@af/shared";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";

export function agentRoutes(app: FastifyInstance): void {
  app.get("/agents", async () => {
    const db = requireDb();
    const agents = await db.query.agent.findMany({ orderBy: (t, o) => o.asc(t.name) });
    const result = [];
    for (const a of agents) {
      const active = await db.query.agentRelease.findFirst({
        where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
      });
      const [runStats] = await db
        .select({ runs: count() })
        .from(agentRun)
        .where(eq(agentRun.agentId, a.id));
      const [openItems] = await db
        .select({ open: count() })
        .from(workItem)
        .where(and(eq(workItem.agentId, a.id), inArray(workItem.status, ["pending", "claimed", "running"])));
      // this calendar month: items worked, tokens, estimated cost (rate card)
      const period = new Date().toISOString().slice(0, 7);
      const monthRows = (
        await db.execute(sql`
          select rel.model_profile, count(*)::int as items,
                 coalesce(sum(r.input_tokens),0)::bigint as tin,
                 coalesce(sum(r.output_tokens),0)::bigint as tout,
                 coalesce(sum(r.cache_write_tokens),0)::bigint as tcw,
                 coalesce(sum(r.cache_read_tokens),0)::bigint as tcr
          from agent.agent_run r
          join agent.agent_release rel on rel.id = r.release_id
          where r.agent_id = ${a.id} and r.finished_at is not null
            and to_char(r.started_at, 'YYYY-MM') = ${period}
          group by rel.model_profile
        `)
      ).rows as { model_profile: string; items: number; tin: string; tout: string; tcw: string; tcr: string }[];
      const { estimateCostCents } = await import("../services/rateCard.js");
      const month = monthRows.reduce(
        (acc, r) => ({
          items: acc.items + r.items,
          tokens: acc.tokens + Number(r.tin) + Number(r.tout) + Number(r.tcw) + Number(r.tcr),
          costCents: acc.costCents + estimateCostCents(r.model_profile, Number(r.tin), Number(r.tout), Number(r.tcw), Number(r.tcr)),
        }),
        { items: 0, tokens: 0, costCents: 0 },
      );
      result.push({
        ...a,
        activeRelease: active ? { id: active.id, version: active.version, modelProfile: active.modelProfile } : null,
        totalRuns: runStats?.runs ?? 0,
        openWorkItems: openItems?.open ?? 0,
        month: { period, ...month },
      });
    }
    return result;
  });

  /** Permissions matrix (UI_CONVENTIONS §2.3): who may propose what, and
   * which commands always need a human — the control-room view. */
  app.get("/agents/permissions", async () => {
    const db = requireDb();
    const { commandDefs } = await import("@af/shared");
    const commands = Object.entries(commandDefs).map(([type, def]) => ({
      type,
      requiresApproval: (def as { requiresApproval: boolean }).requiresApproval,
    }));
    const agents = await db.query.agent.findMany({ orderBy: (t, o) => o.asc(t.process) });
    const rows = [];
    for (const a of agents) {
      const active = await db.query.agentRelease.findFirst({
        where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
      });
      rows.push({
        slug: a.slug,
        name: a.name,
        process: a.process,
        permissions: active?.commandPermissions ?? [],
      });
    }
    return { commands, agents: rows };
  });

  app.get<{ Params: { slug: string } }>("/agents/:slug", async (req, reply) => {
    const db = requireDb();
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
    if (!a) return reply.code(404).send({ error: "agent not found" });
    const releases = await db.query.agentRelease.findMany({
      where: (t) => eq(t.agentId, a.id),
      orderBy: (t) => desc(t.version),
    });
    const skillVersionIds = [...new Set(releases.flatMap((r) => r.skillVersionIds))];
    const versions = skillVersionIds.length
      ? await db.query.skillVersion.findMany({ where: (t) => inArray(t.id, skillVersionIds) })
      : [];
    const skillIds = [...new Set(versions.map((v) => v.skillId))];
    const skills = skillIds.length
      ? await db.query.skill.findMany({ where: (t) => inArray(t.id, skillIds) })
      : [];
    const allVersions = skillIds.length
      ? await db.query.skillVersion.findMany({
          where: (t) => inArray(t.skillId, skillIds),
          orderBy: (t) => desc(t.version),
        })
      : [];
    const evalCases = await db.query.evalCase.findMany({ where: (t) => eq(t.agentId, a.id) });
    const evalRuns = await db.query.evalRun.findMany({
      where: (t) => eq(t.agentId, a.id),
      orderBy: (t) => desc(t.startedAt),
      limit: 10,
    });
    const recentRuns = await db.query.agentRun.findMany({
      where: (t) => eq(t.agentId, a.id),
      orderBy: (t) => desc(t.startedAt),
      limit: 20,
      columns: { transcript: false },
    });
    // Staff-record strip (UI_CONVENTIONS §2.1/§2.5): workload, outcomes,
    // escalation rate, tokens per completed case — from data we already keep.
    const [stats] = (
      await db.execute(sql`
        select
          count(*) filter (where outcome = 'completed')::int as completed,
          count(*) filter (where outcome in ('escalated', 'abstained'))::int as handed_back,
          count(*) filter (where outcome = 'failed')::int as failed,
          count(*)::int as total,
          coalesce(sum(input_tokens + output_tokens + cache_write_tokens + cache_read_tokens), 0)::bigint as tokens
        from agent.agent_run where agent_id = ${a.id} and finished_at is not null
      `)
    ).rows as { completed: number; handed_back: number; failed: number; total: number; tokens: string }[];
    const [open] = (
      await db.execute(sql`
        select count(*)::int as n from agent.work_item
        where agent_id = ${a.id} and status in ('pending', 'claimed', 'running')
      `)
    ).rows as { n: number }[];
    const latestEval = evalRuns.find((e) => e.status === "passed" || e.status === "failed");

    // Performance over time (D14): run aggregates priced by the rate card,
    // joined with eval pass rates — eval_summary survives history flushes,
    // so live eval_run rows are unioned in only when not yet summarised.
    const { estimateCostCents } = await import("../services/rateCard.js");
    const runHistory = (
      await db.execute(sql`
        select to_char(r.started_at, 'YYYY-MM') as period, rel.model_profile,
               count(*)::int as items,
               coalesce(sum(r.input_tokens),0)::bigint as tin,
               coalesce(sum(r.output_tokens),0)::bigint as tout,
               coalesce(sum(r.cache_write_tokens),0)::bigint as tcw,
               coalesce(sum(r.cache_read_tokens),0)::bigint as tcr
        from agent.agent_run r
        join agent.agent_release rel on rel.id = r.release_id
        where r.agent_id = ${a.id} and r.finished_at is not null
        group by 1, 2 order by 1 desc limit 24
      `)
    ).rows as { period: string; model_profile: string; items: number; tin: string; tout: string; tcw: string; tcr: string }[];
    const evalHistory = (
      await db.execute(sql`
        select period_code as period, sum(passed)::int as passed, sum(failed)::int as failed
        from (
          select period_code, passed, failed from agent.eval_summary where agent_id = ${a.id}
          union all
          select to_char(er.started_at, 'YYYY-MM'), er.passed, er.failed
          from agent.eval_run er
          where er.agent_id = ${a.id} and er.status in ('passed', 'failed')
            and not exists (
              select 1 from agent.eval_summary s
              where s.agent_id = er.agent_id
                and s.period_code = to_char(er.started_at, 'YYYY-MM')
                and s.finished_at = er.finished_at
            )
        ) u group by 1
      `)
    ).rows as { period: string; passed: number; failed: number }[];
    const byPeriod = new Map<string, { period: string; items: number; tokens: number; costCents: number; evalPassed: number | null; evalFailed: number | null }>();
    for (const r of runHistory) {
      const row = byPeriod.get(r.period) ?? { period: r.period, items: 0, tokens: 0, costCents: 0, evalPassed: null, evalFailed: null };
      row.items += r.items;
      row.tokens += Number(r.tin) + Number(r.tout) + Number(r.tcw) + Number(r.tcr);
      row.costCents += estimateCostCents(r.model_profile, Number(r.tin), Number(r.tout), Number(r.tcw), Number(r.tcr));
      byPeriod.set(r.period, row);
    }
    for (const e of evalHistory) {
      const row = byPeriod.get(e.period) ?? { period: e.period, items: 0, tokens: 0, costCents: 0, evalPassed: null, evalFailed: null };
      row.evalPassed = e.passed;
      row.evalFailed = e.failed;
      byPeriod.set(e.period, row);
    }
    const history = [...byPeriod.values()].sort((x, y) => y.period.localeCompare(x.period)).slice(0, 6);

    return {
      history,
      agent: a,
      releases,
      skills,
      skillVersions: allVersions,
      evalCases,
      evalRuns,
      recentRuns,
      stats: {
        ...stats,
        tokens: Number(stats?.tokens ?? 0),
        openWorkItems: open?.n ?? 0,
        escalationRate: stats && stats.total > 0 ? Math.round((stats.handed_back / stats.total) * 100) : null,
        tokensPerCompleted: stats && stats.completed > 0 ? Math.round(Number(stats.tokens) / stats.completed) : null,
        latestEval: latestEval
          ? { passed: latestEval.passed, failed: latestEval.failed, status: latestEval.status, at: latestEval.startedAt }
          : null,
      },
    };
  });

  /** The skills library: every skill with its latest version and which
   * agents' ACTIVE releases use it (and at which pinned version, so stale
   * pins are visible). Skills are shared — agents reference them through
   * releases, never own them. */
  app.get("/skills", async () => {
    const db = requireDb();
    const skills = await db.query.skill.findMany({ orderBy: (t) => t.name });
    const versions = await db.query.skillVersion.findMany();
    const latestBySkill = new Map<string, { id: string; version: number; instructions: string }>();
    for (const v of versions) {
      const cur = latestBySkill.get(v.skillId);
      if (!cur || v.version > cur.version) latestBySkill.set(v.skillId, { id: v.id, version: v.version, instructions: v.instructions });
    }
    const versionById = new Map(versions.map((v) => [v.id, v]));
    const activeReleases = await db.query.agentRelease.findMany({ where: (t) => eq(t.status, "active") });
    const agents = await db.query.agent.findMany();
    const agentById = new Map(agents.map((a) => [a.id, a]));
    const usedBy = new Map<string, { agentSlug: string; agentName: string; pinnedVersion: number; stale: boolean }[]>();
    for (const r of activeReleases) {
      for (const vid of r.skillVersionIds) {
        const v = versionById.get(vid);
        if (!v) continue;
        const a = agentById.get(r.agentId);
        if (!a) continue;
        const latest = latestBySkill.get(v.skillId);
        const list = usedBy.get(v.skillId) ?? [];
        list.push({ agentSlug: a.slug, agentName: a.name, pinnedVersion: v.version, stale: !!latest && v.version < latest.version });
        usedBy.set(v.skillId, list);
      }
    }
    return skills.map((s) => {
      const latest = latestBySkill.get(s.id);
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        category: s.category,
        latestVersion: latest?.version ?? 0,
        latestVersionId: latest?.id ?? null,
        latestInstructions: latest?.instructions ?? "",
        versions: versions.filter((v) => v.skillId === s.id).length,
        usedBy: usedBy.get(s.id) ?? [],
      };
    });
  });

  /** Create a new library skill with its first version. */
  app.post("/skills", async (req, reply) => {
    const db = requireDb();
    const body = z
      .object({
        slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
        name: z.string().min(3).max(80),
        description: z.string().min(10).max(300),
        instructions: z.string().min(20),
        createdBy: z.string().min(1),
        category: z.enum(["p2p", "o2c", "r2r", "analytics", "controls", "fpa", "platform"]).default("platform"),
      })
      .parse(req.body);
    const existing = await db.query.skill.findFirst({ where: (t) => eq(t.slug, body.slug) });
    if (existing) return reply.code(409).send({ error: `skill ${body.slug} already exists` });
    const [s] = await db
      .insert(skill)
      .values({ slug: body.slug, name: body.name, description: body.description, category: body.category })
      .returning();
    await db.insert(skillVersion).values({ skillId: s!.id, version: 1, instructions: body.instructions, createdBy: body.createdBy });
    await emitActivity({
      actorType: "human",
      actorId: body.createdBy,
      verb: "created_skill",
      objectType: "skill",
      objectId: body.slug,
      summary: `${body.createdBy} added ${body.name} to the skills library`,
    });
    return { id: s!.id, slug: s!.slug };
  });

  app.post<{ Params: { slug: string } }>("/skills/:slug/versions", async (req, reply) => {
    const db = requireDb();
    const body = createSkillVersionSchema.parse(req.body);
    const s = await db.query.skill.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
    if (!s) return reply.code(404).send({ error: "skill not found" });
    const latest = await db.query.skillVersion.findFirst({
      where: (t) => eq(t.skillId, s.id),
      orderBy: (t) => desc(t.version),
    });
    const [created] = await db
      .insert(skillVersion)
      .values({ skillId: s.id, version: (latest?.version ?? 0) + 1, ...body })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: body.createdBy,
      verb: "created_skill_version",
      objectType: "skill",
      objectId: s.slug,
      summary: `${body.createdBy} saved ${s.name} v${created!.version}`,
    });
    return created;
  });

  app.post<{ Params: { slug: string } }>("/agents/:slug/releases", async (req, reply) => {
    const db = requireDb();
    const body = createReleaseSchema.parse(req.body);
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
    if (!a) return reply.code(404).send({ error: "agent not found" });
    const latest = await db.query.agentRelease.findFirst({
      where: (t) => eq(t.agentId, a.id),
      orderBy: (t) => desc(t.version),
    });
    const [created] = await db
      .insert(agentRelease)
      .values({ agentId: a.id, version: (latest?.version ?? 0) + 1, ...body })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: body.createdBy,
      verb: "created_release",
      objectType: "agent",
      objectId: a.slug,
      summary: `${body.createdBy} drafted ${a.name} release v${created!.version}`,
    });
    return created;
  });

  app.post<{ Params: { slug: string; version: string } }>(
    "/agents/:slug/releases/:version/promote",
    async (req, reply) => {
      const db = requireDb();
      const body = promoteReleaseSchema.parse(req.body);
      const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
      if (!a) return reply.code(404).send({ error: "agent not found" });
      const target = await db.query.agentRelease.findFirst({
        where: (t) => and(eq(t.agentId, a.id), eq(t.version, Number(req.params.version))),
      });
      if (!target) return reply.code(404).send({ error: "release not found" });
      if (target.status === "retired")
        return reply.code(409).send({ error: "cannot promote a retired release" });
      await db.transaction(async (tx) => {
        await tx
          .update(agentRelease)
          .set({ status: "retired" })
          .where(and(eq(agentRelease.agentId, a.id), eq(agentRelease.status, "active")));
        await tx
          .update(agentRelease)
          .set({ status: "active", promotedBy: body.promotedBy, promotedAt: new Date() })
          .where(eq(agentRelease.id, target.id));
      });
      await emitActivity({
        actorType: "human",
        actorId: body.promotedBy,
        verb: "promoted_release",
        objectType: "agent",
        objectId: a.slug,
        summary: `${body.promotedBy} promoted ${a.name} to release v${target.version}`,
      });
      return { ok: true };
    },
  );

  // internal: worker resolves the active release bundle for an agent
  app.get<{ Params: { slug: string } }>("/agents/:slug/active-release", async (req, reply) => {
    const db = requireDb();
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
    if (!a) return reply.code(404).send({ error: "agent not found" });
    const release = await db.query.agentRelease.findFirst({
      where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
    });
    if (!release) return reply.code(404).send({ error: "no active release" });
    const versions = release.skillVersionIds.length
      ? await db.query.skillVersion.findMany({
          where: (t) => inArray(t.id, release.skillVersionIds),
        })
      : [];
    const skills = versions.length
      ? await db.query.skill.findMany({
          where: (t) => inArray(t.id, [...new Set(versions.map((v) => v.skillId))]),
        })
      : [];
    return { agent: a, release, skillVersions: versions, skills };
  });
}
