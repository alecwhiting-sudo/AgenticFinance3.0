import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { loadDemoDataset, truncateTransactions } from "../services/datasetLoader.js";

/** Admin panel backend (demo control room — not part of the finance product).
 * Reset/reload the demo data, replay it live from zero, and host the drip
 * controls that used to sit on the front of the UI. */

type Job = {
  running: boolean;
  mode: string;
  done: number;
  total: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};
const job: Job = { running: false, mode: "", done: 0, total: 0, message: "", startedAt: null, finishedAt: null, error: null };

export function adminRoutes(app: FastifyInstance): void {
  app.get("/admin/status", async () => {
    const db = requireDb();
    const [counts] = (
      await db.execute(sql`
        select (select count(*)::int from erp.purchase) as purchases,
               (select count(*)::int from erp.ap_invoice) as invoices,
               (select count(*)::int from erp.journal) as journals,
               (select count(*)::int from fdp.event) as events,
               (select count(*)::int from erp.bank_transaction) as bank_lines,
               (select coalesce(sum(amount_minor),0)::bigint from erp.journal_line) as balance
      `)
    ).rows;
    return { counts, job };
  });

  /** mode: "reload" (instant), "zero" (truncate only), "replay" (live, paced). */
  app.post<{ Body: { mode?: string; paceMs?: number } }>("/admin/reset", async (req, reply) => {
    const db = requireDb();
    const mode = req.body?.mode ?? "reload";
    if (!["reload", "zero", "replay"].includes(mode))
      return reply.code(400).send({ error: "mode must be reload | zero | replay" });
    if (job.running) return reply.code(409).send({ error: `a ${job.mode} job is already running` });

    job.running = true;
    job.mode = mode;
    job.done = 0;
    job.total = 0;
    job.message = "starting";
    job.startedAt = new Date().toISOString();
    job.finishedAt = null;
    job.error = null;

    const work = async () => {
      try {
        if (mode === "zero") {
          await truncateTransactions(db);
          job.message = "all transaction data cleared — the books are empty";
        } else {
          const paceMs = mode === "replay" ? Math.min(Math.max(Number(req.body?.paceMs ?? 120), 20), 2000) : 0;
          const result = await loadDemoDataset(db, {
            reset: true,
            paceMs,
            onProgress: (done, total, message) => {
              job.done = done;
              job.total = total;
              job.message = message;
            },
          });
          job.message = result.skipped ? "nothing to do" : `loaded — ${result.journals} journals, balance ${result.balance}`;
        }
        await emitActivity({
          actorType: "human",
          actorId: "admin",
          verb: "reset_demo_data",
          objectType: "dataset",
          objectId: mode,
          summary:
            mode === "zero"
              ? "Demo data cleared — books at zero"
              : mode === "replay"
                ? "Demo dataset replayed live from zero"
                : "Demo dataset reset and reloaded",
        });
      } catch (err) {
        job.error = String(err);
        job.message = "failed";
      } finally {
        job.running = false;
        job.finishedAt = new Date().toISOString();
      }
    };

    if (mode === "replay") {
      // long-running: fire and forget; the UI polls /admin/status
      void work();
      return { started: true, mode };
    }
    await work();
    return { started: true, mode, job };
  });
}
