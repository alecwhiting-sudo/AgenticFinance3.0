import type { FastifyInstance } from "fastify";
import { desc, eq, inArray } from "drizzle-orm";
import { agent, agentRun, evalCase, evalRun, workItem } from "@af/db";
import { createWorkItemSchema } from "@af/shared";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";

export function workRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { status?: string } }>("/work-items", async (req) => {
    const db = requireDb();
    const statuses = req.query.status
      ? (req.query.status.split(",") as (typeof workItem.$inferSelect)["status"][])
      : undefined;
    const items = await db.query.workItem.findMany({
      where: statuses ? (t) => inArray(t.status, statuses) : undefined,
      orderBy: (t) => desc(t.createdAt),
      limit: 100,
    });
    const agentIds = [...new Set(items.map((i) => i.agentId).filter((x): x is string => !!x))];
    const agents = agentIds.length
      ? await db.query.agent.findMany({ where: (t) => inArray(t.id, agentIds) })
      : [];
    const bySlug = new Map(agents.map((a) => [a.id, { slug: a.slug, name: a.name }]));
    return items.map((i) => ({ ...i, agent: i.agentId ? bySlug.get(i.agentId) ?? null : null }));
  });

  app.post("/work-items", async (req, reply) => {
    const db = requireDb();
    const body = createWorkItemSchema.parse(req.body);
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, body.agentSlug) });
    if (!a) return reply.code(404).send({ error: `agent ${body.agentSlug} not found` });
    const [created] = await db
      .insert(workItem)
      .values({ type: body.type, agentId: a.id, payload: body.payload, priority: body.priority })
      .returning();
    await emitActivity({
      actorType: "human",
      actorId: "workbench",
      verb: "submitted_work",
      objectType: "work_item",
      objectId: created!.id,
      summary: `New ${body.type} task queued for ${a.name}`,
    });
    return created;
  });

  app.get<{ Querystring: { agent?: string } }>("/runs", async (req) => {
    const db = requireDb();
    let agentId: string | undefined;
    if (req.query.agent) {
      const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.query.agent!) });
      agentId = a?.id;
      if (!agentId) return [];
    }
    return db.query.agentRun.findMany({
      where: agentId ? (t) => eq(t.agentId, agentId!) : undefined,
      orderBy: (t) => desc(t.startedAt),
      limit: 50,
      columns: { transcript: false },
    });
  });

  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const db = requireDb();
    const run = await db.query.agentRun.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!run) return reply.code(404).send({ error: "run not found" });
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.id, run.agentId) });
    const release = await db.query.agentRelease.findFirst({
      where: (t) => eq(t.id, run.releaseId),
    });
    return { run, agent: a, release };
  });

  /** Start an eval suite: one work item per eval case, graded by the worker. */
  app.post<{ Params: { slug: string } }>("/agents/:slug/evals/run", async (req, reply) => {
    const db = requireDb();
    const a = await db.query.agent.findFirst({ where: (t) => eq(t.slug, req.params.slug) });
    if (!a) return reply.code(404).send({ error: "agent not found" });
    const release = await db.query.agentRelease.findFirst({
      where: (t, { and }) => and(eq(t.agentId, a.id), eq(t.status, "active")),
    });
    if (!release) return reply.code(409).send({ error: "agent has no active release" });
    const cases = await db.query.evalCase.findMany({ where: (t) => eq(t.agentId, a.id) });
    if (cases.length === 0) return reply.code(409).send({ error: "agent has no eval cases" });
    const [er] = await db
      .insert(evalRun)
      .values({ agentId: a.id, releaseId: release.id })
      .returning();
    await db.insert(workItem).values(
      cases.map((c) => ({
        type: "eval.case",
        agentId: a.id,
        payload: { evalRunId: er!.id, evalCaseId: c.id, input: c.input },
        priority: 3,
      })),
    );
    await emitActivity({
      actorType: "human",
      actorId: "workbench",
      verb: "started_evals",
      objectType: "agent",
      objectId: a.slug,
      summary: `Eval suite started for ${a.name} (${cases.length} cases)`,
    });
    return er;
  });

  app.get<{ Params: { id: string } }>("/eval-runs/:id", async (req, reply) => {
    const db = requireDb();
    const er = await db.query.evalRun.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!er) return reply.code(404).send({ error: "eval run not found" });
    const cases = await db.query.evalCase.findMany({ where: (t) => eq(t.agentId, er.agentId) });
    return { evalRun: er, cases };
  });
}
