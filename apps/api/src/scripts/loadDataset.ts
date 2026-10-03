/**
 * CLI wrapper around the dataset loader service (services/datasetLoader.ts).
 * Usage: tsx src/scripts/loadDataset.ts [--reset]   (needs DATABASE_URL)
 * RESET_DATASET=true also triggers a reset reload (Railway dashboard path).
 */
import { createDb } from "@af/db";
import { loadDemoDataset } from "../services/datasetLoader.js";

const reset = process.argv.includes("--reset") || process.env.RESET_DATASET === "true";
// Container boot (Dockerfile CMD) only loads when opted in — otherwise a
// restart would trample a month-by-month demo by refilling empty books.
// The Admin panel is the normal way to load/reset data.
if (!reset && !process.argv.includes("--force") && process.env.AUTO_LOAD_DATASET !== "true") {
  console.log("dataset load skipped (set AUTO_LOAD_DATASET=true or RESET_DATASET=true, or pass --force)");
  process.exit(0);
}

const { db, pool } = createDb();

const result = await loadDemoDataset(db, { reset });
await pool.end();
if (!result.skipped && (result.stats.mismatches ?? 0) > 0) process.exit(1);
