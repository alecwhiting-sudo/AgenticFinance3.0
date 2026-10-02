import type { FastifyInstance } from "fastify";
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
      result.push({
        ...a,
        activeRelease: active ? { id: active.id, version: active.version, modelProfile: active.modelProfile } : null,
        totalRuns: runStats?.runs ?? 0,
        openWorkItems: openItems?.open ?? 0,
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
          coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens
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
    return {
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
