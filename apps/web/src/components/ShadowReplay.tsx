"use client";

/** Shadow replay (plans/RELEASE_GOVERNANCE.md M2): run a DRAFT release
 * against the agent's real recent work in the test book and show the
 * measured impact report — what would change, case by case — beside the
 * promote decision. Measurement beats prediction: this is the evidence the
 * human (and later the M3b reviewer) reads before promoting. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

type Side = {
  outcome: string;
  commands: { type: string; resolution: string | null }[];
  modelCalls: number;
};
type CaseResult = {
  originalRunId: string;
  shadowRunId: string;
  taskType: string;
  ref: string;
  exceptionCode: string | null;
  baseline: Side;
  draft: Side;
  changed: boolean;
  changes: string[];
};
type Summary = {
  cases: number;
  changed: number;
  incomparable?: number;
  baselineOutcomes: Record<string, number>;
  draftOutcomes: Record<string, number>;
  resolutionChanges: { ref: string; change?: string }[];
  changedByExceptionCode: Record<string, number>;
  baselineTokens: { modelCalls: number };
  draftTokens: { modelCalls: number };
};
type Replay = {
  id: string;
  status: string;
  cases: number;
  done: number;
  draftVersion: number | null;
  baselineVersion: number | null;
  startedAt: string;
  finishedAt: string | null;
  summary: Summary | null;
  results: CaseResult[];
  costCents: { baseline: number | null; draft: number | null } | null;
};

const cents = (c: number | null) => (c === null ? "—" : `$${(c / 100).toFixed(2)}`);
const escalationPct = (o: Record<string, number>) => {
  const total = Object.values(o).reduce((a, b) => a + b, 0);
  return total ? Math.round(((o.escalated ?? 0) / total) * 100) : 0;
};

export default function ShadowReplayPanel({
  agentSlug,
  draftVersions,
}: {
  agentSlug: string;
  draftVersions: number[];
}) {
  const [replays, setReplays] = useState<Replay[] | null>(null);
  const [version, setVersion] = useState<number | undefined>(draftVersions[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiUrl}/agents/${agentSlug}/shadow`);
      if (r.ok) setReplays(((await r.json()) as { replays: Replay[] }).replays);
    } catch {
      /* retry on next poll */
    }
  }, [agentSlug]);
  useEffect(() => {
    void load();
  }, [load]);
  const running = (replays ?? []).some((r) => r.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  const latest = replays?.[0] ?? null;
  const changedCases = latest?.results.filter((r) => r.changed) ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Shadow replay</h3>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Re-runs this agent&apos;s real recent cases under a draft release in the test book, then
            measures what would change — evidence for the promote decision, not prediction.
          </p>
        </div>
        <span className="inline-flex items-center gap-2">
          {draftVersions.length > 0 ? (
            <>
              <select
                value={version}
                onChange={(e) => setVersion(Number(e.target.value))}
                className="rounded-lg border bg-transparent px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)" }}
              >
                {draftVersions.map((v) => (
                  <option key={v} value={v}>draft v{v}</option>
                ))}
              </select>
              <button
                disabled={busy || running || version === undefined}
                onClick={async () => {
                  setBusy(true);
                  setMsg(null);
                  try {
                    const r = await fetch(`${apiUrl}/agents/${agentSlug}/releases/${version}/shadow`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ createdBy: "workbench", limit: 25 }),
                    });
                    const d = (await r.json()) as { error?: string };
                    setMsg(r.ok ? null : d.error ?? "could not start");
                  } catch {
                    setMsg("could not start");
                  }
                  setBusy(false);
                  void load();
                }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                style={{ background: "var(--accent)" }}
              >
                {busy ? "Starting…" : running ? "Replay running…" : "Run shadow replay"}
              </button>
            </>
          ) : (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              needs a draft release (edit skills or refresh pins first)
            </span>
          )}
        </span>
      </div>
      {msg && <p className="mt-1 text-xs" style={{ color: "var(--bad)" }}>{msg}</p>}

      {latest && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <span className="font-medium" style={{ color: "var(--foreground)" }}>
              draft v{latest.draftVersion} vs active v{latest.baselineVersion}
            </span>
            {latest.status === "running" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
                {latest.done} / {latest.cases} cases replayed…
              </span>
            ) : (
              <span>{latest.cases} cases · finished {latest.finishedAt ? new Date(latest.finishedAt).toLocaleString() : ""}</span>
            )}
          </div>

          {latest.summary && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  { v: String(latest.summary.cases), l: "cases replayed" },
                  {
                    v: String(latest.summary.changed),
                    l: "would change",
                    tone: latest.summary.changed > 0 ? "var(--warn)" : "var(--good)",
                  },
                  {
                    v: `${escalationPct(latest.summary.baselineOutcomes)}% → ${escalationPct(latest.summary.draftOutcomes)}%`,
                    l: "escalation rate",
                  },
                  {
                    v: `${latest.summary.baselineTokens.modelCalls} → ${latest.summary.draftTokens.modelCalls}`,
                    l: "model calls",
                  },
                  {
                    v: `${cents(latest.costCents?.baseline ?? null)} → ${cents(latest.costCents?.draft ?? null)}`,
                    l: "est. model cost (rate card)",
                  },
                ].map((s) => (
                  <div key={s.l} className="rounded-lg border p-3 text-center" style={{ borderColor: "var(--border)" }}>
                    <div className="num text-base font-semibold tracking-tight" style={s.tone ? { color: s.tone } : undefined}>{s.v}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{s.l}</div>
                  </div>
                ))}
              </div>

              {(latest.summary.incomparable ?? 0) > 0 && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {latest.summary.incomparable} case{latest.summary.incomparable === 1 ? "" : "s"} not comparable — the
                  baseline&apos;s proposed commands were pruned by an earlier demo reset, so only outcome is compared there.
                </p>
              )}
              {Object.keys(latest.summary.changedByExceptionCode).length > 0 && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  changed by exception code:{" "}
                  {Object.entries(latest.summary.changedByExceptionCode)
                    .map(([c, n]) => `${c.replaceAll("_", " ")} ×${n}`)
                    .join(" · ")}
                </p>
              )}

              {changedCases.length > 0 ? (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    What would change, case by case
                  </div>
                  <ul className="space-y-1.5 text-xs">
                    {(showAll ? changedCases : changedCases.slice(0, 8)).map((c) => (
                      <li key={c.shadowRunId} className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
                        <span className="font-medium">{c.ref}</span>
                        {c.exceptionCode && <span style={{ color: "var(--muted)" }}> · {c.exceptionCode.replaceAll("_", " ")}</span>}
                        <span style={{ color: "var(--warn)" }}> — {c.changes.join("; ")}</span>{" "}
                        <Link href={`/runs/${c.originalRunId}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                          original
                        </Link>{" "}
                        <Link href={`/runs/${c.shadowRunId}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                          shadow
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {changedCases.length > 8 && (
                    <button onClick={() => setShowAll(!showAll)} className="mt-1 text-xs hover:underline" style={{ color: "var(--accent)" }}>
                      {showAll ? "show fewer" : `show all ${changedCases.length}`}
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--good)" }}>
                  No behavioural changes measured — the draft handled every replayed case exactly as the active release did.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {replays !== null && replays.length === 0 && (
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
          No replays yet. Draft a release, then measure it here before promoting.
        </p>
      )}
    </div>
  );
}
