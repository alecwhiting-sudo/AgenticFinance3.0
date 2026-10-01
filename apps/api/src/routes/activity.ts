import type { FastifyInstance } from "fastify";
import { recentActivity, startActivityTail, subscribe, type ActivityRow } from "../lib/activity.js";

function toWire(row: ActivityRow): string {
  return JSON.stringify({
    id: row.id,
    at: row.at,
    seq: row.seq,
    actorType: row.actorType,
    actorId: row.actorId,
    verb: row.verb,
    objectType: row.objectType,
    objectId: row.objectId,
    caseId: row.caseId,
    summary: row.summary,
  });
}

export function activityRoutes(app: FastifyInstance): void {
  startActivityTail();

  app.get<{ Querystring: { limit?: string } }>("/activity", async (req) => {
    const rows = await recentActivity(Math.min(Number(req.query.limit ?? 50), 200));
    return rows.map((r) => JSON.parse(toWire(r)));
  });

  /** Server-Sent Events stream of activity (ARCHITECTURE.md §6a). */
  app.get("/activity/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    reply.raw.write("retry: 3000\n\n");

    void recentActivity(25).then((rows) => {
      for (const row of rows.reverse()) {
        reply.raw.write(`event: activity\ndata: ${toWire(row)}\n\n`);
      }
    });

    const unsubscribe = subscribe((row) => {
      reply.raw.write(`event: activity\ndata: ${toWire(row)}\n\n`);
    });
    const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

    req.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}
