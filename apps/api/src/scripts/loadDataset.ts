/**
 * CLI wrapper around the dataset loader service (services/datasetLoader.ts).
 * Usage: tsx src/scripts/loadDataset.ts [--reset]   (needs DATABASE_URL)
 * RESET_DATASET=true also triggers a reset reload (Railway dashboard path).
 */
import { createDb } from "@af/db";
import { loadDemoDataset } from "../services/datasetLoader.js";

const { db, pool } = createDb();
const reset = process.argv.includes("--reset") || process.env.RESET_DATASET === "true";

const result = await loadDemoDataset(db, { reset });
await pool.end();
if (!result.skipped && (result.stats.mismatches ?? 0) > 0) process.exit(1);
