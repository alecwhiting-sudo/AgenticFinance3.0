/**
 * Shadow replay (plans/RELEASE_GOVERNANCE.md M2): re-run an agent's REAL
 * recent work under a draft release and measure what would change. Source
 * cases are the agent's own completed work items (latest run per item,
 * evals and earlier shadows excluded) — their original payloads are
 * re-queued as `shadow.case` items pinned to the draft, so the gateway
 * books every command into the test book (D16) and nothing human-visible
 * moves. The worker diffs each shadow run against its original and closes
 * the replay with an aggregate impact report; promotion stays a human
 * decision informed by measurement, not prediction.
 */
import { sql } from "drizzle-orm";
import { shadowReplay, workItem, type Db, type agent as agentTable, type agentRelease } from "@af/db";

export async function startShadowReplay(
  db: Db,
  a: typeof agentTable.$inferSelect,
  draft: typeof agentRelease.$inferSelect,
  baseline: typeof agentRelease.$inferSelect,
  opts: { limit: number; createdBy: string },
): Promise<typeof shadowReplay.$inferSelect | { error: string }> {
  const limit = Math.min(100, Math.max(1, opts.limit));
  const rows = (
    await db.execute(sql`
      select * from (
        select distinct on (w.id) w.id as work_item_id, w.type, w.payload,
               r.id as run_id, r.started_at
        from agent.work_item w
        join agent.agent_run r on r.work_item_id = w.id
        where w.agent_id = ${a.id}
          and w.type not in ('eval.case', 'shadow.case')
          and r.outcome is not null
        order by w.id, r.started_at desc
      ) t order by t.started_at desc limit ${limit}
    `)
  ).rows as { work_item_id: string; type: string; payload: Record<string, unknown>; run_id: string }[];
  if (rows.length === 0) return { error: "no completed historical work items to replay" };

  const [sr] = await db
    .insert(shadowReplay)
    .values({
      agentId: a.id,
      draftReleaseId: draft.id,
      baselineReleaseId: baseline.id,
      cases: rows.length,
      createdBy: opts.createdBy,
    })
    .returning();
  await db.insert(workItem).values(
    rows.map((r) => ({
      type: "shadow.case",
      agentId: a.id,
      payload: {
        shadowId: sr!.id,
        originalRunId: r.run_id,
        taskType: r.type,
        input: r.payload,
        releaseId: draft.id,
      },
      priority: 3,
    })),
  );
  return sr!;
}
