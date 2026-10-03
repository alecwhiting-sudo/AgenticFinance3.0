import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Db } from "./client.js";

/** Apply any pending migrations programmatically (same journal as the
 * db:migrate CLI, so the two paths never conflict). Used by the API's boot
 * script so a deploy is self-contained — no manual `railway run` step. */
export async function runMigrations(db: Db): Promise<void> {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  await migrate(db, { migrationsFolder });
}
