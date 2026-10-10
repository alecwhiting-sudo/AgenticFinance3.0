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
  agentSkill,
  workItem,
} from "@af/db";
import {
  createReleaseSchema,
  createSkillVersionSchema,
  promoteReleaseSchema,
} from "@af/shared";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { startEvalSuite } from "../services/evalSuite.js";
import { refreshStaleReleases } from "../services/releaseRefresh.js";
import { startShadowReplay } from "../services/shadowReplay.js";
import { estimateCostCents } from "../services/rateCard.js";
import { controlRegressionDiff } from "../lib/skillDiff.js";

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
    // what each agent's ACTIVE release actually pins, per skill
    const pinnedByAgentSkill = new Map<string, number>(); // `${agentId}:${skillId}` -> version
    for (const r of activeReleases) {
      for (const vid of r.skillVersionIds) {
        const v = versionById.get(vid);
        if (v) pinnedByAgentSkill.set(`${r.agentId}:${v.skillId}`, v.version);
      }
    }
    // usedBy comes from the CENTRAL map (agent_skill — the curriculum);
    // pinnedVersion is null when the agent is mapped but its active release
    // has not picked the skill up yet
    const mappings = await db.query.agentSkill.findMany();
    const usedBy = new Map<string, { agentSlug: string; agentName: string; pinnedVersion: number | null; stale: boolean }[]>();
    for (const m of mappings) {
      const a = agentById.get(m.agentId);
      if (!a) continue;
      const latest = latestBySkill.get(m.skillId);
      const pinned = pinnedByAgentSkill.get(`${m.agentId}:${m.skillId}`) ?? null;
      const list = usedBy.get(m.skillId) ?? [];
      list.push({
        agentSlug: a.slug,
        agentName: a.name,
        pinnedVersion: pinned,
        stale: pinned !== null && !!latest && pinned < latest.version,
      });
      usedBy.set(m.skillId, list);
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

  /** Latest version id of every skill in the agent's central map — what a
   * rebuilt release pins when no explicit versions are given. */
  async function latestVersionIdsFromMap(db: ReturnType<typeof requireDb>, agentId: string): Promise<string[]> {
    const mapped = await db.query.agentSkill.findMany({ where: (t) => eq(t.agentId, agentId) });
    const ids: string[] = [];
    for (const m of mapped) {
      const latest = await db.query.skillVersion.findFirst({
        where: (t) => eq(t.skillId, m.skillId),
        orderBy: (t) => desc(t.version),
      });
      if (latest) ids.push(latest.id);
    }
    return ids;
  }

  app.post<{ Params: { slug: string } }>("/agents/:slug/releases", async (req, reply) => {
    const db = requireDb();
    const body = createReleaseSchema.parse(req.body);
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
    if (!a) return reply.code(404).send({ error: "agent not found" });
    const latest = await db.query.agentRelease.findFirst({
      where: (t) => eq(t.agentId, a.id),
      orderBy: (t) => desc(t.version),
    });
    // a rebuild without explicit versions reads the central map (agent_skill)
    // and pins each mapped skill's latest version
    const skillVersionIds =
      body.skillVersionIds && body.skillVersionIds.length > 0
        ? body.skillVersionIds
        : await latestVersionIdsFromMap(db, a.id);
    const [created] = await db
      .insert(agentRelease)
      .values({ agentId: a.id, version: (latest?.version ?? 0) + 1, ...body, skillVersionIds })
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

  /** What a stale-pin refresh WOULD touch: per stale agent, who they are,
   * what they may propose (the consequence surface if a skill is wrong),
   * exactly which skill pins change, and how strong the eval gate is. The
   * UI shows this before the user confirms. */
  async function staleAgentDetails(db: ReturnType<typeof requireDb>) {
    const agents = await db.query.agent.findMany();
    const allSkills = await db.query.skill.findMany();
    const allVersions = await db.query.skillVersion.findMany();
    const skillById = new Map(allSkills.map((s) => [s.id, s]));
    const versionById = new Map(allVersions.map((v) => [v.id, v]));
    const latestBySkill = new Map<string, { id: string; version: number }>();
    for (const v of allVersions) {
      const cur = latestBySkill.get(v.skillId);
      if (!cur || v.version > cur.version) latestBySkill.set(v.skillId, { id: v.id, version: v.version });
    }
    const out: {
      agentSlug: string;
      agentName: string;
      purpose: string;
      commandPermissions: string[];
      evalCases: number;
      activeVersion: number;
      inFlight?: { draftVersion: number; evalStatus: string; failed: number; failures: string[] };
      changes: { skillName: string; from: number | null; to: number; diff?: ReturnType<typeof controlRegressionDiff> }[];
      agentId: string;
      desired: string[];
    }[] = [];
    for (const a of agents) {
      const active = await db.query.agentRelease.findFirst({
        where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
      });
      if (!active) continue;
      const mapped = await db.query.agentSkill.findMany({ where: (t) => eq(t.agentId, a.id) });
      const pinnedBySkill = new Map<string, number>();
      for (const vid of active.skillVersionIds) {
        const v = versionById.get(vid);
        if (v) pinnedBySkill.set(v.skillId, v.version);
      }
      const changes: {
        skillName: string;
        from: number | null;
        to: number;
        diff?: ReturnType<typeof controlRegressionDiff>;
      }[] = [];
      const desired: string[] = [];
      const textOf = (skillId: string, version: number) =>
        allVersions.find((v) => v.skillId === skillId && v.version === version)?.instructions ?? "";
      for (const m of mapped) {
        const latest = latestBySkill.get(m.skillId);
        if (!latest) continue;
        desired.push(latest.id);
        const pinned = pinnedBySkill.get(m.skillId) ?? null;
        if (pinned !== latest.version) {
          // M3a control-regression check: what operative lines would the
          // agent LOSE by moving from the pinned text to the latest?
          const diff =
            pinned !== null ? controlRegressionDiff(textOf(m.skillId, pinned), textOf(m.skillId, latest.version)) : undefined;
          changes.push({
            skillName: skillById.get(m.skillId)?.name ?? m.skillId,
            from: pinned,
            to: latest.version,
            ...(diff && (diff.removedNeverDo.length || diff.removedMethod.length || !diff.comparable) ? { diff } : {}),
          });
        }
      }
      if (changes.length === 0) continue;
      const cases = await db.query.evalCase.findMany({ where: (t) => eq(t.agentId, a.id) });
      // surface any refresh draft already in flight and HOW its suite went,
      // so "still stale" is never a mystery
      let inFlight:
        | { draftVersion: number; evalStatus: string; failed: number; failures: string[] }
        | undefined;
      const latestRelease = await db.query.agentRelease.findFirst({
        where: (t) => eq(t.agentId, a.id),
        orderBy: (t) => desc(t.version),
      });
      if (latestRelease && latestRelease.status === "draft" && (latestRelease.notes ?? "").includes("[auto-promote]")) {
        const er = await db.query.evalRun.findFirst({
          where: (t) => eq(t.releaseId, latestRelease.id),
          orderBy: (t) => desc(t.startedAt),
        });
        const failures = ((er?.results ?? []) as { passed?: boolean; name?: string; failures?: string[] }[])
          .filter((r) => r.passed === false)
          .slice(0, 3)
          .map((r) => `${r.name}: ${(r.failures ?? []).join("; ")}`);
        inFlight = {
          draftVersion: latestRelease.version,
          evalStatus: er?.status ?? "no eval run recorded",
          failed: er?.failed ?? 0,
          failures,
        };
      }
      out.push({
        ...(inFlight ? { inFlight } : {}),
        agentSlug: a.slug,
        agentName: a.name,
        purpose: a.purpose,
        commandPermissions: active.commandPermissions,
        evalCases: cases.length,
        activeVersion: active.version,
        changes,
        agentId: a.id,
        desired: desired.sort(),
      });
    }
    return out;
  }

  /** Shadow replay (plans/RELEASE_GOVERNANCE.md M2): run a DRAFT release
   * against the agent's real recent work in the test book and measure the
   * difference. The report informs the human promote decision. */
  app.post<{ Params: { slug: string; version: string } }>(
    "/agents/:slug/releases/:version/shadow",
    async (req, reply) => {
      const db = requireDb();
      const body = z
        .object({ createdBy: z.string().min(1), limit: z.number().int().min(1).max(100).default(25) })
        .parse(req.body ?? {});
      const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
      if (!a) return reply.code(404).send({ error: "agent not found" });
      const draft = await db.query.agentRelease.findFirst({
        where: (t) => and(eq(t.agentId, a.id), eq(t.version, Number(req.params.version))),
      });
      if (!draft || draft.status !== "draft")
        return reply.code(409).send({ error: "shadow replay runs against a DRAFT release" });
      const baseline = await db.query.agentRelease.findFirst({
        where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
      });
      if (!baseline) return reply.code(409).send({ error: "agent has no active baseline release" });
      const started = await startShadowReplay(db, a, draft, baseline, {
        limit: body.limit,
        createdBy: body.createdBy,
      });
      if ("error" in started) return reply.code(409).send(started);
      await emitActivity({
        actorType: "human",
        actorId: body.createdBy,
        verb: "started_shadow_replay",
        objectType: "agent",
        objectId: a.id,
        summary: `Shadow replay: draft v${draft.version} re-running ${started.cases} real cases against active v${baseline.version} (test book)`,
      });
      return { shadow: started };
    },
  );

  /** Recent shadow replays for an agent, priced at read time (D14/D15). */
  app.get<{ Params: { slug: string } }>("/agents/:slug/shadow", async (req, reply) => {
    const db = requireDb();
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
    if (!a) return reply.code(404).send({ error: "agent not found" });
    const rows = await db.query.shadowReplay.findMany({
      where: (t) => eq(t.agentId, a.id),
      orderBy: (t) => desc(t.startedAt),
      limit: 5,
    });
    const versions = new Map<string, number>();
    for (const r of await db.query.agentRelease.findMany({ where: (t) => eq(t.agentId, a.id) }))
      versions.set(r.id, r.version);
    const active = await db.query.agentRelease.findFirst({
      where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
    });
    const price = (side: Record<string, number> | undefined) =>
      side
        ? estimateCostCents(
            active?.modelProfile ?? "default",
            side.inputTokens ?? 0,
            side.outputTokens ?? 0,
            side.cacheWriteTokens ?? 0,
            side.cacheReadTokens ?? 0,
          )
        : null;
    return {
      replays: rows.map((r) => {
        const s = (r.summary ?? null) as {
          baselineTokens?: Record<string, number>;
          draftTokens?: Record<string, number>;
        } | null;
        return {
          id: r.id,
          status: r.status,
          cases: r.cases,
          done: r.results.length,
          draftVersion: versions.get(r.draftReleaseId) ?? null,
          baselineVersion: versions.get(r.baselineReleaseId) ?? null,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          summary: r.summary ?? null,
          results: r.results,
          costCents: s
            ? { baseline: price(s.baselineTokens), draft: price(s.draftTokens) }
            : null,
        };
      }),
    };
  });

  app.get("/agents/releases/refresh-stale", async () => {
    const db = requireDb();
    const details = await staleAgentDetails(db);
    return {
      agents: details.map(({ agentId: _a, desired: _d, ...rest }) => rest),
    };
  });

  /** The stale-pin cleanup: for every agent whose active release does not
   * pin the latest version of each centrally-mapped skill, draft a rebuilt
   * release from the map and start its eval suite against THAT draft. A
   * fully green suite auto-promotes it (the worker handles that — standard
   * eval-before-promote governance with the promote step automated).
   * Agents without eval cases get the draft only, flagged for manual
   * promotion. */
  app.post("/agents/releases/refresh-stale", async (req) => {
    const db = requireDb();
    const body = z.object({ updatedBy: z.string().min(1) }).parse(req.body ?? {});
    // human-confirmed path: the UI showed the control-regression preview, so
    // no requireCleanDiff — the confirm IS the acceptance (M3a)
    const results = await refreshStaleReleases(db, body.updatedBy);
    await emitActivity({
      actorType: "human",
      actorId: body.updatedBy,
      verb: "refreshed_stale_releases",
      objectType: "agent",
      objectId: "all",
      summary: `Stale-skill refresh: ${results.filter((r) => r.draftVersion).length} drafts created`,
    });
    return { results };
  });

  /** Replace an agent's central skill map (the curriculum) and draft a
   * release pinned to the latest version of each mapped skill. The release
   * still goes through eval → promote; the map changes immediately. */
  app.put<{ Params: { slug: string } }>("/agents/:slug/skill-map", async (req, reply) => {
    const db = requireDb();
    const body = z
      .object({ skillSlugs: z.array(z.string()).max(30), updatedBy: z.string().min(1) })
      .parse(req.body);
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
    if (!a) return reply.code(404).send({ error: "agent not found" });
    const skills = body.skillSlugs.length
      ? await db.query.skill.findMany({ where: (t) => inArray(t.slug, body.skillSlugs) })
      : [];
    const missing = body.skillSlugs.filter((s) => !skills.some((k) => k.slug === s));
    if (missing.length) return reply.code(400).send({ error: `unknown skills: ${missing.join(", ")}` });

    const wantedIds = new Set(skills.map((s) => s.id));
    const current = await db.query.agentSkill.findMany({ where: (t) => eq(t.agentId, a.id) });
    for (const m of current) {
      if (!wantedIds.has(m.skillId)) await db.delete(agentSkill).where(eq(agentSkill.id, m.id));
    }
    for (const id of wantedIds) {
      if (!current.some((m) => m.skillId === id)) {
        await db.insert(agentSkill).values({ agentId: a.id, skillId: id, addedBy: body.updatedBy });
      }
    }

    // draft the rebuilt release from the active one's settings + the new map
    const active = await db.query.agentRelease.findFirst({
      where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
    });
    const latest = await db.query.agentRelease.findFirst({
      where: (t) => eq(t.agentId, a.id),
      orderBy: (t) => desc(t.version),
    });
    if (!active) return reply.code(409).send({ error: "no active release to base the draft on" });
    const skillVersionIds = await latestVersionIdsFromMap(db, a.id);
    const [draft] = await db
      .insert(agentRelease)
      .values({
        agentId: a.id,
        version: (latest?.version ?? 0) + 1,
        instructions: active.instructions,
        skillVersionIds,
        commandPermissions: active.commandPermissions,
        modelProfile: active.modelProfile,
        maxModelCalls: active.maxModelCalls,
        maxCostMinor: active.maxCostMinor,
        status: "draft",
        notes: `Skill map changed by ${body.updatedBy}: ${body.skillSlugs.join(", ") || "(none)"}`,
        createdBy: body.updatedBy,
      })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: body.updatedBy,
      verb: "updated_skill_map",
      objectType: "agent",
      objectId: a.slug,
      summary: `${body.updatedBy} set ${a.name}'s skill map (${body.skillSlugs.length} skills) — draft v${draft!.version}`,
    });
    return { skillSlugs: body.skillSlugs, draftRelease: { id: draft!.id, version: draft!.version } };
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
