/**
 * Agent worker skeleton. In Phase 1 this process claims work items from the
 * agent.work_item queue and runs agent loops. For Phase 0 it proves the
 * deploy shape: connects to the database, exposes /health for Railway, and
 * heartbeats so it is visible in logs.
 */
import Fastify from "fastify";
import pg from "pg";
import { createDb } from "@af/db";
import type { Health } from "@af/shared";

const VERSION = "0.1.0";
const SERVICE = "worker";
const HEARTBEAT_MS = 30_000;

let pool: pg.Pool | null = null;
try {
  ({ pool } = createDb());
} catch {
  // run degraded; /health reports it
}

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

setInterval(async () => {
  app.log.info({ db: (await dbOk()) ? "ok" : "unavailable" }, "heartbeat");
}, HEARTBEAT_MS);

const port = Number(process.env.PORT ?? 3002);
await app.listen({ port, host: "0.0.0.0" });
app.log.info("worker up — queue processing arrives in Phase 1");
