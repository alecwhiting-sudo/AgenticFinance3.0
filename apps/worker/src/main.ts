/**
 * Agent worker: claims work items from the agent.work_item queue and runs
 * agent loops (ARCHITECTURE.md §1, §4). Exposes /health for Railway.
 */
import Fastify from "fastify";
import type { Health } from "@af/shared";
import { pool } from "./lib/db.js";
import { startProcessor } from "./runtime/processor.js";

const VERSION = "0.2.0";
const SERVICE = "worker";

async function dbOk(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.get("/health", async (): Promise<Health> => {
  const ok = await dbOk();
  return {
    status: ok ? "ok" : "degraded",
    service: SERVICE,
    db: ok ? "ok" : "unavailable",
    version: VERSION,
    time: new Date().toISOString(),
  };
});

const port = Number(process.env.PORT ?? 3002);
await app.listen({ port, host: "0.0.0.0" });
startProcessor((msg) => app.log.info(msg));
app.log.info(
  `worker up — model ${process.env.ANTHROPIC_API_KEY ? "enabled" : "DISABLED (no ANTHROPIC_API_KEY; deterministic handlers only)"}`,
);
