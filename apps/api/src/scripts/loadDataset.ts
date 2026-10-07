/**
 * CLI wrapper around the dataset loader service (services/datasetLoader.ts).
 * Usage: tsx src/scripts/loadDataset.ts [--reset]   (needs DATABASE_URL)
 * RESET_DATASET=true also triggers a reset reload (Railway dashboard path).
 */
import { createDb, runMigrations, seedCore } from "@af/db";
import { loadDemoDataset } from "../services/datasetLoader.js";

const reset = process.argv.includes("--reset") || process.env.RESET_DATASET === "true";

// Every boot: apply pending migrations and refresh the registry seed
// (idempotent, non-destructive — master data, skills, agents, releases).
// A deploy is then self-contained: new skills/agents appear without a
// manual migrate or a dataset wipe. Opt out with MIGRATE_ON_BOOT=false.
if (process.env.MIGRATE_ON_BOOT !== "false") {
  const boot = createDb();
  try {
    await runMigrations(boot.db);
    console.log("migrations applied");
    await seedCore(boot.db);
    console.log("registry seed refreshed");
    // Stale-pin refresh on every deploy: the seed may have shipped new skill
    // versions, so draft the rebuilt releases now and queue their eval
    // suites — the worker auto-promotes each on a green suite. Governance is
    // preserved: control-regression moves (M3a) are skipped here and wait
    // for the human preview on the Agents page, and agents without eval
    // cases still need a manual promote. Opt out: REFRESH_PINS_ON_BOOT=false.
    if (process.env.REFRESH_PINS_ON_BOOT !== "false") {
      const { refreshStaleReleases } = await import("../services/releaseRefresh.js");
      const results = await refreshStaleReleases(boot.db, "boot", { requireCleanDiff: true });
      for (const r of results) if (r.status !== "current") console.log(`stale-pin refresh: ${r.agentSlug} — ${r.status}`);
      if (results.every((r) => r.status === "current")) console.log("stale-pin refresh: all pins current");
    }
  } catch (err) {
    // never block the API from starting; the admin panel can still load
    console.error(`boot migrate/seed failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await boot.pool.end();
  }
}

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
