import cors from "@fastify/cors";
import Fastify from "fastify";
import { count, eq } from "drizzle-orm";
import {
  account,
  createDb,
  customer,
  item,
  supplier,
  type Db,
} from "@af/db";
import type { CompanyOverview, Health } from "@af/shared";
import pg from "pg";

const VERSION = "0.1.0";
const SERVICE = "api";

let db: Db | null = null;
let pool: pg.Pool | null = null;
try {
  ({ db, pool } = createDb());
} catch {
  // Boot without a database so healthchecks still answer; /health says degraded.
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true });

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

  const countOf = async (table: typeof account | typeof supplier | typeof customer | typeof item) =>
    (await db!.select({ n: count() }).from(table))[0]?.n ?? 0;

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

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
