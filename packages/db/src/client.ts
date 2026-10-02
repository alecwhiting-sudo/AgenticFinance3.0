import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as tables from "./schema.js";

export const schema = { ...tables };

export type Db = NodePgDatabase<typeof schema>;

export function createDb(databaseUrl = process.env.DATABASE_URL): {
  db: Db;
  pool: pg.Pool;
} {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}
