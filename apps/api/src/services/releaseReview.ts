/**
 * AI release review (plans/RELEASE_GOVERNANCE.md M3b): the Release Reviewer
 * agent reads a draft's measured evidence and writes an ADVISORY opinion for
 * the human at the promote decision. Everything deterministic happens HERE,
 * in code, at enqueue time — the facts pack (eval suite result, M3a
 * control-regression diff per changed skill, latest shadow-replay impact
 * report) is assembled by the API and handed to the reviewer, so the model
 * spends its judgement interpreting measurements, never gathering them.
 * Grounding rule from the plan: an opinion without shadow measurements is
 * labelled "predicted, not measured"; with them it must reconcile its claims
 * to the measured diff. The review never promotes or blocks by itself.
 */
import { desc, eq } from "drizzle-orm";
import {
  agent as agentTable,
  agentRelease,
  evalRun,
  releaseReview,
  shadowReplay,
  skillVersion,
  workItem,
  type Db,
} from "@af/db";
import { controlRegressionDiff } from "../lib/skillDiff.js";

const REVIEWER_SLUG = "release-reviewer";

export type ReviewFacts = {
  agentSlug: string;
  agentName: string;
  draftVersion: number;
  baselineVersion: number | null;
  /** latest finished eval suite run against the draft, if any */
  evalSuite: { status: string; passed: number; failed: number; failures: string[] } | null;
  /** M3a diff per skill whose pinned version changed baseline → draft */
  controlDiff: { skill: string; comparable: boolean; removedNeverDo: string[]; removedMethod: string[] }[];
  /** latest COMPLETE shadow replay for the draft: the measured impact */
  shadow: {
    summary: Record<string, unknown>;
    topChanges: { ref: string; exceptionCode: string | null; changes: string[] }[];
  } | null;
  /** every changed fraud-risk case in the replay, with what the DRAFT did —
   * so the verdict can tell a weakening (draft resolves or completes a hold)
   * from a strengthening (draft adds evidence while still holding) */
  fraudChanges: { ref: string; exceptionCode: string; draftOutcome: string; draftProposesResolve: boolean }[];
};

/** Build the deterministic facts pack for a draft under review. */
export async function assembleReviewFacts(
  db: Db,
  a: typeof agentTable.$inferSelect,
  draft: typeof agentRelease.$inferSelect,
  baseline: typeof agentRelease.$inferSelect | null,
): Promise<{ facts: ReviewFacts; shadowId: string | null }> {
  // eval suite: latest finished run targeting the draft release
  const runs = await db.query.evalRun.findMany({
    where: eq(evalRun.releaseId, draft.id),
    orderBy: desc(evalRun.startedAt),
    limit: 5,
  });
  const finished = runs.find((r) => r.status !== "running") ?? null;
  const evalSuite = finished
    ? {
        status: finished.status,
        passed: finished.passed,
        failed: finished.failed,
        failures: (finished.results as { name?: string; passed?: boolean; failures?: string[] }[])
          .filter((r) => r.passed === false)
          .flatMap((r) => (r.failures ?? []).map((f) => `${r.name ?? "case"}: ${f}`))
          .slice(0, 12),
      }
    : null;

  // control-regression diff per skill whose pinned version changed
  const controlDiff: ReviewFacts["controlDiff"] = [];
  if (baseline) {
    const oldIds = baseline.skillVersionIds as string[];
    const newIds = draft.skillVersionIds as string[];
    const all = [...new Set([...oldIds, ...newIds])];
    const versions = all.length
      ? await db.query.skillVersion.findMany({ where: (t, { inArray }) => inArray(t.id, all) })
      : [];
    const bySkill = new Map<string, { old?: typeof skillVersion.$inferSelect; neu?: typeof skillVersion.$inferSelect }>();
    for (const v of versions) {
      const slot = bySkill.get(v.skillId) ?? {};
      if (oldIds.includes(v.id)) slot.old = v;
      if (newIds.includes(v.id)) slot.neu = v;
      bySkill.set(v.skillId, slot);
    }
    for (const [skillId, { old, neu }] of bySkill) {
      if (!old || !neu || old.id === neu.id) continue;
      const skill = await db.query.skill.findFirst({ where: (t, { eq: e }) => e(t.id, skillId) });
      const d = controlRegressionDiff(old.instructions, neu.instructions);
      controlDiff.push({ skill: skill?.name ?? skillId, ...d });
    }
  }

  // latest complete shadow replay measuring this draft
  const sr = await db.query.shadowReplay.findFirst({
    where: (t, { and, eq: e }) => and(e(t.draftReleaseId, draft.id), e(t.status, "complete")),
    orderBy: desc(shadowReplay.startedAt),
  });
  type ReplayRow = {
    ref?: string;
    exceptionCode?: string | null;
    changed?: boolean;
    changes?: string[];
    draft?: { outcome?: string; commands?: { type: string; resolution: string | null }[] };
  };
  const rows = (sr?.results ?? []) as ReplayRow[];
  const shadow = sr?.summary
    ? {
        summary: sr.summary,
        topChanges: rows
          .filter((r) => r.changed)
          .slice(0, 10)
          .map((r) => ({ ref: r.ref ?? "?", exceptionCode: r.exceptionCode ?? null, changes: r.changes ?? [] })),
      }
    : null;
  const fraudChanges = rows
    .filter((r) => r.changed && (r.exceptionCode ?? "").includes("bank_detail"))
    .map((r) => ({
      ref: r.ref ?? "?",
      exceptionCode: r.exceptionCode!,
      draftOutcome: r.draft?.outcome ?? "unknown",
      draftProposesResolve: (r.draft?.commands ?? []).some((c) => c.type === "ap.invoice.resolve"),
    }));

  return {
    facts: {
      agentSlug: a.slug,
      agentName: a.name,
      draftVersion: draft.version,
      baselineVersion: baseline?.version ?? null,
      evalSuite,
      controlDiff,
      shadow,
      fraudChanges,
    },
    shadowId: sr?.id ?? null,
  };
}

/** Create a review row and queue the reviewer agent on it. One review per
 * call; repeated calls give a fresh review (history keeps the older ones). */
export async function startReleaseReview(
  db: Db,
  a: typeof agentTable.$inferSelect,
  draft: typeof agentRelease.$inferSelect,
  baseline: typeof agentRelease.$inferSelect | null,
  createdBy: string,
): Promise<typeof releaseReview.$inferSelect | { error: string }> {
  const reviewer = await db.query.agent.findFirst({ where: (t, { eq: e }) => e(t.slug, REVIEWER_SLUG) });
  if (!reviewer) return { error: "no release-reviewer agent registered — reseed the registry" };
  const { facts, shadowId } = await assembleReviewFacts(db, a, draft, baseline);
  const [review] = await db
    .insert(releaseReview)
    .values({
      agentId: a.id,
      releaseId: draft.id,
      shadowReplayId: shadowId,
      grounded: facts.shadow !== null,
      facts: facts as unknown as Record<string, unknown>,
      createdBy,
    })
    .returning();
  await db.insert(workItem).values({
    type: "release.review",
    agentId: reviewer.id,
    payload: { reviewId: review!.id, facts },
    priority: 3,
  });
  return review!;
}
