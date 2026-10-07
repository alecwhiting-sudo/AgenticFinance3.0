/**
 * Stale-pin refresh (plans/RELEASE_GOVERNANCE.md): for every agent whose
 * active release does not pin the latest version of each centrally-mapped
 * skill, draft a rebuilt release from the map and start its eval suite
 * against THAT draft. A fully green suite auto-promotes it (the worker
 * handles that — standard eval-before-promote governance with the promote
 * step automated). Agents without eval cases get the draft only, flagged
 * for manual promotion.
 *
 * Callers: the Agents-page button (POST /agents/releases/refresh-stale,
 * human-confirmed after the control-regression preview) and api BOOT right
 * after the registry seed — so a deploy that ships new skill versions
 * refreshes its own pins. The boot path passes requireCleanDiff: an agent
 * whose pin move would DROP never-do/method lines (M3a) is skipped there
 * and left for the human preview; automation never waves a control
 * regression through.
 */
import { desc, eq, and } from "drizzle-orm";
import { agentRelease, type Db } from "@af/db";
import { controlRegressionDiff } from "../lib/skillDiff.js";
import { startEvalSuite } from "./evalSuite.js";

export type RefreshResult = {
  agentSlug: string;
  status: string;
  draftVersion?: number;
  evalRunId?: string;
};

export async function refreshStaleReleases(
  db: Db,
  updatedBy: string,
  opts: { requireCleanDiff?: boolean } = {},
): Promise<RefreshResult[]> {
  const agents = await db.query.agent.findMany();
  const allVersions = await db.query.skillVersion.findMany();
  const latestBySkill = new Map<string, { id: string; version: number }>();
  for (const v of allVersions) {
    const cur = latestBySkill.get(v.skillId);
    if (!cur || v.version > cur.version) latestBySkill.set(v.skillId, { id: v.id, version: v.version });
  }
  const textOf = (skillId: string, version: number) =>
    allVersions.find((v) => v.skillId === skillId && v.version === version)?.instructions ?? "";
  const results: RefreshResult[] = [];

  for (const a of agents) {
    const active = await db.query.agentRelease.findFirst({
      where: (t) => and(eq(t.agentId, a.id), eq(t.status, "active")),
    });
    if (!active) continue;
    const mapped = await db.query.agentSkill.findMany({ where: (t) => eq(t.agentId, a.id) });
    const desired = mapped
      .map((m) => latestBySkill.get(m.skillId)?.id)
      .filter((x): x is string => !!x)
      .sort();
    const pinned = [...active.skillVersionIds].sort();
    if (desired.join(",") === pinned.join(",")) {
      results.push({ agentSlug: a.slug, status: "current" });
      continue;
    }

    // Boot path (M3a): a pin move that drops operative lines normally waits
    // for the human preview on the Agents page. The one exception is a
    // SEED-AUTHORED target version — that text shipped from the repo, so the
    // commit/PR review was its acceptance; boot takes it and says exactly
    // which lines moved, loudly, in the log. A version edited in the UI
    // (createdBy != "seed") never auto-accepts a regression here.
    if (opts.requireCleanDiff) {
      const pinnedBySkill = new Map<string, number>();
      for (const vid of active.skillVersionIds) {
        const v = allVersions.find((x) => x.id === vid);
        if (v) pinnedBySkill.set(v.skillId, v.version);
      }
      let blocked = false;
      for (const m of mapped) {
        const latest = latestBySkill.get(m.skillId);
        const from = pinnedBySkill.get(m.skillId);
        if (!latest || from === undefined || from === latest.version) continue;
        const diff = controlRegressionDiff(textOf(m.skillId, from), textOf(m.skillId, latest.version));
        if (!diff.comparable || diff.removedNeverDo.length > 0 || diff.removedMethod.length > 0) {
          const latestRow = allVersions.find((x) => x.skillId === m.skillId && x.version === latest.version);
          if (latestRow?.createdBy === "seed") {
            console.log(
              `stale-pin refresh: ${a.slug} — control-regression accepted (seed-authored v${latest.version}): ` +
                `${[...diff.removedNeverDo, ...diff.removedMethod].slice(0, 3).join(" | ") || "section layout changed"}`,
            );
            continue;
          }
          blocked = true;
          break;
        }
      }
      if (blocked) {
        results.push({
          agentSlug: a.slug,
          status: "skipped: control-regression diff on a UI-authored version — confirm from the Agents page",
        });
        continue;
      }
    }

    // a refresh draft may already exist from an earlier pass — do the
    // useful thing per its state rather than skipping blindly
    const latestRelease = await db.query.agentRelease.findFirst({
      where: (t) => eq(t.agentId, a.id),
      orderBy: (t) => desc(t.version),
    });
    if (latestRelease && latestRelease.status === "draft" && (latestRelease.notes ?? "").includes("[auto-promote]")) {
      const draftPins = [...latestRelease.skillVersionIds].sort().join(",");
      if (draftPins === desired.join(",")) {
        const er = await db.query.evalRun.findFirst({
          where: (t) => eq(t.releaseId, latestRelease.id),
          orderBy: (t) => desc(t.startedAt),
        });
        if (er?.status === "running") {
          results.push({
            agentSlug: a.slug,
            status: "draft evals still running — if this persists, check the worker is up",
            draftVersion: latestRelease.version,
            evalRunId: er.id,
          });
          continue;
        }
        // failed suite, or a suite graded before auto-promotion existed:
        // re-run the evals on the SAME draft — a green suite promotes it
        const restarted = await startEvalSuite(db, a, latestRelease);
        results.push(
          "error" in restarted
            ? {
                agentSlug: a.slug,
                status: `draft v${latestRelease.version} waiting for MANUAL promotion (no eval cases — promote from the agent's page)`,
                draftVersion: latestRelease.version,
              }
            : {
                agentSlug: a.slug,
                status: `draft v${latestRelease.version} evals re-run (previous suite: ${er ? `${er.status}, ${er.failed} failed` : "none recorded"}) — promotes when green`,
                draftVersion: latestRelease.version,
                evalRunId: restarted.evalRun.id,
              },
        );
        continue;
      }
      // the draft's pins are outdated (skills moved again) — supersede it
      await db.update(agentRelease).set({ status: "retired" }).where(eq(agentRelease.id, latestRelease.id));
    }
    const [draft] = await db
      .insert(agentRelease)
      .values({
        agentId: a.id,
        version: (latestRelease?.version ?? active.version) + 1,
        instructions: active.instructions,
        skillVersionIds: desired,
        commandPermissions: active.commandPermissions,
        modelProfile: active.modelProfile,
        maxModelCalls: active.maxModelCalls,
        maxCostMinor: active.maxCostMinor,
        status: "draft",
        notes: `[auto-promote] Skill refresh by ${updatedBy}: pins the latest version of each mapped skill`,
        createdBy: updatedBy,
      })
      .returning();

    const started = await startEvalSuite(db, a, draft!);
    if ("error" in started) {
      results.push({ agentSlug: a.slug, status: "draft created — no eval cases, promote manually", draftVersion: draft!.version });
      continue;
    }
    results.push({
      agentSlug: a.slug,
      status: `draft + evals running — promotes when green${started.skipped.length ? ` (${started.skipped.length} live case(s) skipped: no matching record)` : ""}`,
      draftVersion: draft!.version,
      evalRunId: started.evalRun.id,
    });
  }
  return results;
}
