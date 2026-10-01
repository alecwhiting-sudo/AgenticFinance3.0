import { createDb, type Db } from "@af/db";
import pg from "pg";

let handle: { db: Db; pool: pg.Pool } | null = null;
try {
  handle = createDb();
} catch {
  // boot degraded; /health reports it and the processor stays idle
}

export const db: Db | null = handle?.db ?? null;
export const pool: pg.Pool | null = handle?.pool ?? null;
