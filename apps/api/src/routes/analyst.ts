import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { workItem } from "@af/db";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";

/** Phase 4c M2 (plans/ANALYTICS.md): the chat panel's two endpoints. A
 * question becomes an ordinary analyst.question work item through the normal
 * queue — the Analyst Agent answers from the curated views only — and the
 * panel polls for the run's answer. Read-only end to end: the agent holds no
 * write permissions, so nothing a question says can change the books. */
export function analystRoutes(app: FastifyInstance): void {
  app.post<{ Body: { question?: string; history?: { role: string; text: string }[] } }>(
    "/analyst/ask",
    async (req, reply) => {
      const db = requireDb();
      const question = (req.body?.question ?? "").trim();
      if (question.length < 3 || question.length > 2000)
        return reply.code(400).send({ error: "question must be 3-2000 characters" });
      const history = Array.isArray(req.body?.history)
        ? req.body!.history!
            .slice(-6)
            .map((h) => ({ role: h.role === "user" ? "user" : "analyst", text: String(h.text).slice(0, 2000) }))
        : [];

      const agentRow = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "analyst") });
      if (!agentRow)
        return reply.code(409).send({ error: "analyst agent not seeded — reload the dataset or run db:seed" });

      const [wi] = await db
        .insert(workItem)
        .values({
          type: "analyst.question",
          agentId: agentRow.id,
          payload: { question, ...(history.length ? { history } : {}) },
          priority: 2, // a person is waiting on the other end
        })
        .returning();
      await emitActivity({
        actorType: "human",
        actorId: "workbench",
        verb: "asked_analyst",
        objectType: "work_item",
        objectId: wi!.id,
        summary: `Analyst asked: ${question.slice(0, 80)}`,
      });
      return { workItemId: wi!.id };
    },
  );

  /** Poll for the answer: pending/running until the run finishes, then the
   * run's outcome and summary (the summary IS the answer, sources line
   * included). */
  app.get<{ Params: { id: string } }>("/analyst/answer/:id", async (req, reply) => {
    const db = requireDb();
    const wi = await db.query.workItem.findFirst({ where: (t) => eq(t.id, req.params.id) });
    if (!wi || wi.type !== "analyst.question") return reply.code(404).send({ error: "question not found" });
    const run = await db.query.agentRun.findFirst({
      where: (t) => eq(t.workItemId, wi.id),
      orderBy: (t) => desc(t.startedAt),
    });
    return {
      status: wi.status,
      outcome: run?.outcome ?? null,
      answer: run?.resultSummary ?? null,
      runId: run?.id ?? null,
    };
  });
}
