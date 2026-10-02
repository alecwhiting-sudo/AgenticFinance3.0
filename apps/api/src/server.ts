import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { count, eq } from "drizzle-orm";
import { account, customer, item, supplier } from "@af/db";
import type { CompanyOverview, Health } from "@af/shared";
import { ZodError } from "zod";
import { db, pool } from "./lib/db.js";
import { agentRoutes } from "./routes/agents.js";
import { workRoutes } from "./routes/work.js";
import { commandRoutes } from "./routes/commands.js";
import { activityRoutes } from "./routes/activity.js";
import { p2pRoutes } from "./routes/p2p.js";
import { dripRoutes } from "./routes/drip.js";
import { paymentRoutes } from "./routes/payments.js";
import { r2rRoutes } from "./routes/r2r.js";

const VERSION = "0.2.0";
const SERVICE = "api";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true });

// Serve the demo evidence documents (D10): PDFs/emails/CSVs from the repo.
await app.register(fastifyStatic, {
  root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/db/seed/documents"),
  prefix: "/documents/",
  decorateReply: false,
});

app.setErrorHandler((err: unknown, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: "validation failed", issues: err.issues });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  app.log.error(err);
  const message = err instanceof Error ? err.message : "internal error";
  return reply.code(status).send({ error: message });
});

async function dbOk(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

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

app.get("/company/overview", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database unavailable" });
  const co = await db.query.company.findFirst();
  if (!co) return reply.code(404).send({ error: "no company seeded" });

  const today = new Date().toISOString().slice(0, 10);
  const period = await db.query.fiscalPeriod.findFirst({
    where: (p, { and, lte, gte }) =>
      and(eq(p.companyId, co.id), lte(p.startDate, today), gte(p.endDate, today)),
  });

  const countOf = async (
    table: typeof account | typeof supplier | typeof customer | typeof item,
  ) => (await db!.select({ n: count() }).from(table))[0]?.n ?? 0;

  const overview: CompanyOverview = {
    company: { code: co.code, name: co.name, currency: co.currency },
    currentPeriod: period ? { code: period.code, status: period.status } : null,
    counts: {
      accounts: await countOf(account),
      suppliers: await countOf(supplier),
      customers: await countOf(customer),
      items: await countOf(item),
    },
  };
  return overview;
});

agentRoutes(app);
workRoutes(app);
commandRoutes(app);
activityRoutes(app);
p2pRoutes(app);
dripRoutes(app);
paymentRoutes(app);
r2rRoutes(app);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
