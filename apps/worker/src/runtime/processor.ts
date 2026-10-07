/**
 * Queue processor: claims pending work items with FOR UPDATE SKIP LOCKED,
 * resolves the assigned agent's active release, runs the agent loop, and
 * records outcomes. Eval work items (type "eval.case") are additionally
 * graded against their eval case's assertions.
 */
import { and, eq, sql } from "drizzle-orm";
import { agentRelease, agentRun, command, evalRun, evalSummary, workItem } from "@af/db";
import { db } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { runAgentLoop, type ResolvedRelease } from "./agentLoop.js";

const WORKER_ID = `worker-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1500);

type WorkItemRow = typeof workItem.$inferSelect;

async function claimNext(): Promise<WorkItemRow | null> {
  if (!db) return null;
  const rows = await db.execute(sql`
    update agent.work_item
    set status = 'claimed', claimed_by = ${WORKER_ID}, attempts = attempts + 1
    where id = (
      select id from agent.work_item
      where status = 'pending' and scheduled_at <= now()
      order by priority asc, created_at asc
      for update skip locked
      limit 1
    )
    returning *
  `);
  const row = (rows as unknown as { rows: Record<string, unknown>[] }).rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    agentId: row.agent_id,
    caseId: row.case_id,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    claimedBy: row.claimed_by,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  } as WorkItemRow;
}

async function resolveActiveRelease(agentId: string, releaseId?: string): Promise<ResolvedRelease | null> {
  if (!db) return null;
  const a = await db.query.agent.findFirst({ where: (t) => eq(t.id, agentId) });
  if (!a) return null;
  // eval work items may target a SPECIFIC release (so a draft is genuinely
  // evaluated before promotion); everything else runs the active one
  const release = releaseId
    ? await db.query.agentRelease.findFirst({
        where: (t) => and(eq(t.agentId, a.id), eq(t.id, releaseId)),
      })
    : await db.query.agentRelease.findFirst({
        where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
      });
  if (!release || release.status === "retired") return null;
  const versions = release.skillVersionIds.length
    ? await db.query.skillVersion.findMany({
        where: (t, { inArray }) => inArray(t.id, release.skillVersionIds),
      })
    : [];
  const skills = [];
  for (const v of versions) {
    const s = await db.query.skill.findFirst({ where: (t) => eq(t.id, v.skillId) });
    if (s) skills.push({ skill: s, version: v });
  }
  return { agent: a, release, skills };
}

async function gradeEvalCase(
  evalRunId: string,
  evalCaseId: string,
  runId: string,
  outcome: string,
  summary: string,
): Promise<void> {
  if (!db) return;
  const ec = await db.query.evalCase.findFirst({ where: (t) => eq(t.id, evalCaseId) });
  if (!ec) return;
  const failures: string[] = [];
  for (const assertion of ec.assertions) {
    if (assertion.kind === "outcome" && outcome !== assertion.value) {
      failures.push(`expected outcome ${assertion.value}, got ${outcome}`);
    }
    // live-data cases assert invariants: any of several outcomes may be right
    if (assertion.kind === "outcome_in" && !assertion.value.split("|").includes(outcome)) {
      failures.push(`expected outcome in [${assertion.value}], got ${outcome}`);
    }
    if (
      assertion.kind === "summary_contains" &&
      !summary.toLowerCase().includes(assertion.value.toLowerCase())
    ) {
      failures.push(`summary does not contain "${assertion.value}"`);
    }
    if (assertion.kind === "command_proposed") {
      const cmd = await db.query.command.findFirst({
        where: (t) => and(eq(t.runId, runId), eq(t.type, assertion.value)),
      });
      if (!cmd) failures.push(`no ${assertion.value} command proposed`);
    }
    if (assertion.kind === "not_command_proposed") {
      const cmd = await db.query.command.findFirst({
        where: (t) => and(eq(t.runId, runId), eq(t.type, assertion.value)),
      });
      if (cmd) failures.push(`${assertion.value} was proposed but must not be`);
    }
    if (
      assertion.kind === "summary_not_contains" &&
      summary.toLowerCase().includes(assertion.value.toLowerCase())
    ) {
      failures.push(`summary must not contain "${assertion.value}"`);
    }
    // Payload assertions grade the CONTENT of a proposed command, value
    // "<commandType>::<arg>" — the commentary-quality bar (plans/R2R.md §9):
    // bland output that names no figures fails here, not in a human review.
    if (
      assertion.kind === "payload_contains" ||
      assertion.kind === "payload_not_contains" ||
      assertion.kind === "payload_min_money"
    ) {
      const sep = assertion.value.indexOf("::");
      const cmdType = sep === -1 ? assertion.value : assertion.value.slice(0, sep);
      const arg = sep === -1 ? "" : assertion.value.slice(sep + 2);
      const cmd = await db.query.command.findFirst({
        where: (t) => and(eq(t.runId, runId), eq(t.type, cmdType)),
      });
      if (!cmd) {
        failures.push(`no ${cmdType} command to check ${assertion.kind}`);
      } else {
        const text = JSON.stringify(cmd.params);
        if (assertion.kind === "payload_contains" && !text.toLowerCase().includes(arg.toLowerCase())) {
          failures.push(`${cmdType} payload does not contain "${arg}"`);
        }
        if (assertion.kind === "payload_not_contains" && text.toLowerCase().includes(arg.toLowerCase())) {
          failures.push(`${cmdType} payload must not contain "${arg}"`);
        }
        if (assertion.kind === "payload_min_money") {
          const n = (text.match(/£\s?\d[\d,]*(?:\.\d+)?/g) ?? []).length;
          if (n < Number(arg)) failures.push(`${cmdType} payload names ${n} £ figure(s) — the bar is ${arg}`);
        }
      }
    }
  }
  const passed = failures.length === 0;

  // Append this case's result and close the eval run when all cases are in.
  const er = await db.query.evalRun.findFirst({ where: (t) => eq(t.id, evalRunId) });
  if (!er) return;
  const results = [...er.results, { evalCaseId, runId, name: ec.name, passed, failures }];
  const totalCases = await db.query.evalCase.findMany({ where: (t) => eq(t.agentId, er.agentId) });
  const done = results.length >= totalCases.length;
  const passCount = results.filter((r) => (r as { passed?: boolean }).passed).length;
  const finishedAt = new Date();
  await db
    .update(evalRun)
    .set({
      results,
      passed: passCount,
      failed: results.length - passCount,
      ...(done
        ? {
            status: results.length === passCount ? "passed" : "failed",
            finishedAt,
          }
        : {}),
    })
    .where(eq(evalRun.id, evalRunId));
  if (done) {
    // D14: compact rollup that survives demo-data flushes — eval history
    // stays comparable period on period even after raw rows are pruned.
    const release = await db.query.agentRelease.findFirst({ where: (t) => eq(t.id, er.releaseId) });
    await db.insert(evalSummary).values({
      agentId: er.agentId,
      releaseVersion: release?.version ?? 0,
      periodCode: finishedAt.toISOString().slice(0, 7),
      passed: passCount,
      failed: results.length - passCount,
      finishedAt,
    });
    await emitActivity({
      actorType: "system",
      actorId: "eval-harness",
      verb: "finished_evals",
      objectType: "eval_run",
      objectId: evalRunId,
      summary: `Eval suite finished: ${passCount}/${results.length} passed`,
    });

    // Auto-promotion: ONLY for drafts explicitly marked [auto-promote] (the
    // stale-skill refresh flow), and only on a fully green suite — the
    // standard governance (eval before promote) with the promote step
    // automated, attributed to the harness.
    const allPassed = results.length === passCount && results.length > 0;
    if (allPassed && release && release.status === "draft" && (release.notes ?? "").includes("[auto-promote]")) {
      await db.transaction(async (tx) => {
        await tx
          .update(agentRelease)
          .set({ status: "retired" })
          .where(and(eq(agentRelease.agentId, release.agentId), eq(agentRelease.status, "active")));
        await tx
          .update(agentRelease)
          .set({ status: "active", evalRunId, promotedBy: "eval-harness", promotedAt: finishedAt })
          .where(eq(agentRelease.id, release.id));
      });
      await emitActivity({
        actorType: "system",
        actorId: "eval-harness",
        verb: "promoted_release",
        objectType: "agent",
        objectId: release.agentId,
        summary: `Release v${release.version} auto-promoted after a green eval suite (${passCount}/${results.length})`,
      });
    }
  }
}

async function processItem(item: WorkItemRow): Promise<void> {
  if (!db) return;
  if (!item.agentId) {
    await db
      .update(workItem)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(workItem.id, item.id));
    return;
  }
  const targetReleaseId =
    item.type === "eval.case" && typeof item.payload.releaseId === "string" ? item.payload.releaseId : undefined;
  const resolved = await resolveActiveRelease(item.agentId, targetReleaseId);
  if (!resolved) {
    await db
      .update(workItem)
      .set({ status: "escalated", completedAt: new Date() })
      .where(eq(workItem.id, item.id));
    await emitActivity({
      actorType: "system",
      actorId: WORKER_ID,
      verb: "escalated",
      objectType: "work_item",
      objectId: item.id,
      summary: `No active release for the assigned agent — item escalated`,
    });
    return;
  }

  const [run] = await db
    .insert(agentRun)
    .values({
      agentId: resolved.agent.id,
      releaseId: resolved.release.id,
      workItemId: item.id,
      evalCaseId: (item.payload.evalCaseId as string) ?? null,
    })
    .returning();

  await db.update(workItem).set({ status: "running" }).where(eq(workItem.id, item.id));
  await emitActivity({
    actorType: "agent",
    actorId: resolved.agent.slug,
    verb: "claimed",
    objectType: "work_item",
    objectId: item.id,
    summary: `${resolved.agent.name} picked up a ${item.type} task (release v${resolved.release.version})`,
  });

  const isEval = item.type === "eval.case";
  const payload = isEval ? ((item.payload.input as Record<string, unknown>) ?? {}) : item.payload;
  const taskType = isEval ? "eval.case" : item.type;

  let outcome: string;
  let summary: string;
  try {
    const result = await runAgentLoop(resolved, run!.id, taskType, payload, );
    outcome = result.outcome;
    summary = result.summary;
  } catch (err) {
    outcome = "failed";
    summary = `Unhandled error: ${err instanceof Error ? err.message : String(err)}`;
  }

  await db
    .update(agentRun)
    .set({ outcome: outcome as typeof agentRun.$inferSelect.outcome, resultSummary: summary, finishedAt: new Date() })
    .where(eq(agentRun.id, run!.id));
  await db
    .update(workItem)
    .set({
      status: outcome === "completed" || outcome === "abstained" ? "completed" : outcome === "escalated" ? "escalated" : "failed",
      completedAt: new Date(),
    })
    .where(eq(workItem.id, item.id));

  await emitActivity({
    actorType: "agent",
    actorId: resolved.agent.slug,
    verb: outcome,
    objectType: "run",
    objectId: run!.id,
    summary: `${resolved.agent.name} ${outcome === "completed" ? "finished" : outcome} the ${item.type} task`,
  });

  if (isEval && item.payload.evalRunId && item.payload.evalCaseId) {
    await gradeEvalCase(
      String(item.payload.evalRunId),
      String(item.payload.evalCaseId),
      run!.id,
      outcome,
      summary,
    );
  }
}

export function startProcessor(log: (msg: string) => void): void {
  let busy = false;
  setInterval(async () => {
    if (busy || !db) return;
    busy = true;
    try {
      let item = await claimNext();
      while (item) {
        log(`claimed ${item.type} (${item.id})`);
        await processItem(item);
        item = await claimNext();
      }
    } catch (err) {
      log(`processor error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  }, POLL_MS);
}
