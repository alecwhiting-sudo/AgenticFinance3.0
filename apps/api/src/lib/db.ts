import { createDb, type Db } from "@af/db";
import pg from "pg";

let handle: { db: Db; pool: pg.Pool } | null = null;
try {
  handle = createDb();
} catch {
  // Boot without a database; /health reports degraded.
}

export const db: Db | null = handle?.db ?? null;
export const pool: pg.Pool | null = handle?.pool ?? null;

export function requireDb(): Db {
  if (!handle) throw Object.assign(new Error("database unavailable"), { statusCode: 503 });
  return handle.db;
}
