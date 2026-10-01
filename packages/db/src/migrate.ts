import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDb } from "./index.js";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

const { db, pool } = createDb();
await migrate(db, { migrationsFolder });
console.log("migrations applied");
await pool.end();
