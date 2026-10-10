"use client";

/** Shadow replay (plans/RELEASE_GOVERNANCE.md M2): run a DRAFT release
 * against the agent's real recent work in the test book and show the
 * measured impact report — what would change, case by case — beside the
 * promote decision. Measurement beats prediction: this is the evidence the
 * human (and later the M3b reviewer) reads before promoting. */
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

/* ---- Plain-English narration (readable by an AP processor, not just a
 * developer): each side of a comparison becomes a sentence describing what
 * the agent did / would do, and the draft side says how it differs. ---- */

// what each proposed resolution means, in words
const RESOLUTION_PHRASE: Record<string, string> = {
  retro_purchase: "raise a retrospective purchase order so the spend gets proper approval",
  approve_adjusted: "accept the invoice for payment",
  part_approve: "pay only for the goods actually received",
  reject: "reject the invoice and ask the supplier to re-bill correctly",
  record_receipt: "book the missing goods receipt, then pay in full",
  hold: "keep the invoice on hold",
  apply_residual: "apply the cash and chase the remaining balance",
  refund_overpay: "refund the overpayment to the customer",
  hold_query: "hold the cash until the query is answered",
};
const resPhrase = (r: string) => RESOLUTION_PHRASE[r] ?? r.replaceAll("_", " ");

// short forms for the one-line row summary
const RESOLUTION_SHORT: Record<string, string> = {
  retro_purchase: "a retrospective purchase order",
  approve_adjusted: "accepting the invoice",
  part_approve: "paying for received goods only",
  reject: "rejecting for re-billing",
  record_receipt: "booking the receipt then paying",
  hold: "holding the invoice",
  apply_residual: "applying cash & chasing the rest",
  refund_overpay: "a refund",
  hold_query: "holding the cash",
};
const resShort = (r: string) => RESOLUTION_SHORT[r] ?? r.replaceAll("_", " ");

const findResolution = (s: Side) =>
  s.commands.find((c) => c.resolution)?.resolution ?? null;
const hasCmd = (s: Side, t: string) => s.commands.some((c) => c.type === t);

/** One readable paragraph for a side: what happened on this case. */
function describeSide(side: Side): string {
  const resolution = findResolution(side);
  const options = hasCmd(side, "case.options");
  const note = hasCmd(side, "case.note");
  switch (side.outcome) {
    case "failed":
      return "This run failed before reaching a recommendation, so there is nothing to compare.";
    case "abstained":
      return (
        "Deliberately took no action and left the invoice held" +
        (options ? ", setting out on the case file what a human should check" : "") +
        ". For fraud-risk holds this is the correct behaviour — only a human releases them after verifying with the supplier."
      );
    case "escalated":
      return (
        "Stopped and referred the case to a human to decide" +
        (options ? ", with the possible ways forward set out on the case file" : note ? ", leaving a note explaining why" : "") +
        ". No resolution was proposed."
      );
    default: {
      // completed
      let s = resolution
        ? `Worked the case through and recommended: ${resPhrase(resolution)}.`
        : "Worked the case through without proposing a resolution.";
      s += options
        ? " The options it weighed up are recorded on the case file."
        : " It did not record any options on the case file.";
      return s;
    }
  }
}

// base form ("would …") and past form ("the live release …") per outcome
const OUTCOME_BASE: Record<string, string> = {
  completed: "work the case to a recommendation",
  escalated: "stop and hand it to a human",
  abstained: "hold it and deliberately do nothing",
  failed: "fail to finish",
};
const OUTCOME_PAST: Record<string, string> = {
  completed: "worked the case to a recommendation",
  escalated: "stopped and handed it to a human",
  abstained: "held it and deliberately did nothing",
  failed: "failed to finish",
};

/** One sentence: how the draft's handling differs from the live release's. */
function describeDifference(c: CaseResult): string {
  const bRes = findResolution(c.baseline);
  const dRes = findResolution(c.draft);
  if (c.baseline.outcome !== c.draft.outcome) {
    let s = `Where the live release ${OUTCOME_PAST[c.baseline.outcome] ?? c.baseline.outcome}, the draft would ${
      OUTCOME_BASE[c.draft.outcome] ?? c.draft.outcome
    }.`;
    if (bRes && !dRes) s += ` The live recommendation (${resShort(bRes)}) would no longer be made.`;
    if (!bRes && dRes) s += ` The draft would newly recommend ${resShort(dRes)}.`;
    return s;
  }
  if (bRes && dRes && bRes !== dRes) {
    let s = `Both finish the case, but they recommend different actions: the live release proposed ${resShort(
      bRes,
    )}, the draft would propose ${resShort(dRes)}.`;
    if (hasCmd(c.baseline, "case.options") && !hasCmd(c.draft, "case.options"))
      s += " The draft also records less supporting detail on the case file.";
    return s;
  }
  if (hasCmd(c.baseline, "case.options") !== hasCmd(c.draft, "case.options"))
    return hasCmd(c.baseline, "case.options")
      ? "Same decision, but the draft records less of its working on the case file (no options set out for the approver)."
      : "Same decision, and the draft records more of its working on the case file.";
  return "Same decision, reached with slightly different steps recorded on the case.";
}

/** Short phrase for the collapsed row: the gist of the change. */
function shortDifference(c: CaseResult): string {
  const bRes = findResolution(c.baseline);
  const dRes = findResolution(c.draft);
  if (c.baseline.outcome !== c.draft.outcome)
    return `would now ${OUTCOME_BASE[c.draft.outcome] ?? c.draft.outcome} (live: ${
      OUTCOME_PAST[c.baseline.outcome] ?? c.baseline.outcome
    })`;
  if (bRes && dRes && bRes !== dRes) return `would recommend ${resShort(dRes)} instead of ${resShort(bRes)}`;
  return "same decision, different working recorded";
}

export default function ShadowReplayPanel({
  agentSlug,
  draftVersions,
}: {
  agentSlug: string;
  draftVersions: number[];
}) {
  const [replays, setReplays] = useState<Replay[] | null>(null);
  const [version, setVersion] = useState<number | undefined>(draftVersions[0]);
  // how many recent real cases to replay — fewer = faster (each one is a
  // full agent run, with model calls on live)
  const CASE_CHOICES = [1, 5, 10, 15, 20, 25];
  const [cases, setCases] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // "show all" survives a round-trip to a run page (per-tab convenience)
  const [showAll, setShowAllState] = useState(false);
  useEffect(() => {
    try {
      setShowAllState(sessionStorage.getItem(`shadow-all-${agentSlug}`) === "1");
    } catch {
      /* storage unavailable */
    }
  }, [agentSlug]);
  const setShowAll = (v: boolean) => {
    setShowAllState(v);
    try {
      sessionStorage.setItem(`shadow-all-${agentSlug}`, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

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
    <div data-tour="shadow-replay">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Shadow replay</h3>
          <p className="max-w-3xl text-xs" style={{ color: "var(--muted)" }}>
            Takes the exact tasks this agent already handled — the same invoices and receipts, same
            inputs — and runs them again under the proposed draft release, side by side with what the
            live release actually did. Everything executes into the <em>test book</em>: a parallel set
            of books the real accounts, approvals inbox and reports never read, so nothing real moves.
            The result is measured evidence for the promote decision, not a prediction.
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
              <select
                value={cases}
                onChange={(e) => setCases(Number(e.target.value))}
                className="rounded-lg border bg-transparent px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)" }}
                title="How many recent real cases to replay — fewer is faster"
              >
                {CASE_CHOICES.map((n) => (
                  <option key={n} value={n}>{n} case{n === 1 ? "" : "s"}</option>
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
                      body: JSON.stringify({ createdBy: "workbench", limit: cases }),
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
                    l: "handled differently",
                    tone: latest.summary.changed > 0 ? "var(--warn)" : "var(--good)",
                  },
                  {
                    v: `${escalationPct(latest.summary.baselineOutcomes)}% → ${escalationPct(latest.summary.draftOutcomes)}%`,
                    l: "sent to a human (live → draft)",
                  },
                  {
                    v: `${latest.summary.baselineTokens.modelCalls} → ${latest.summary.draftTokens.modelCalls}`,
                    l: "AI calls used (live → draft)",
                  },
                  {
                    v: `${cents(latest.costCents?.baseline ?? null)} → ${cents(latest.costCents?.draft ?? null)}`,
                    l: "est. AI cost (live → draft)",
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
                    Cases the draft would handle differently — expand a row to compare
                  </div>
                  <ul className="space-y-1.5 text-xs">
                    {(showAll ? changedCases : changedCases.slice(0, 8)).map((c) => (
                      <li key={c.shadowRunId} className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
                        <details>
                          <summary className="cursor-pointer p-2">
                            <span className="font-medium">{c.ref}</span>
                            {c.exceptionCode && <span style={{ color: "var(--muted)" }}> · {c.exceptionCode.replaceAll("_", " ")}</span>}
                            <span style={{ color: "var(--warn)" }}> — {shortDifference(c)}</span>
                          </summary>
                          <div className="border-t p-2" style={{ borderColor: "var(--border)" }}>
                            <p className="mb-2 rounded-lg p-2 font-medium" style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)" }}>
                              {describeDifference(c)}
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {(
                                [
                                  { title: `What the live release (v${latest.baselineVersion}) did`, side: c.baseline, run: c.originalRunId },
                                  { title: `What the draft (v${latest.draftVersion}) would do`, side: c.draft, run: c.shadowRunId },
                                ] as const
                              ).map(({ title, side, run }) => (
                                <div key={title} className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
                                  <div className="mb-1 flex items-baseline justify-between gap-2">
                                    <span className="font-semibold">{title}</span>
                                    <a
                                      href={`/runs/${run}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="shrink-0 hover:underline"
                                      style={{ color: "var(--accent)" }}
                                    >
                                      full run ↗
                                    </a>
                                  </div>
                                  <p className="leading-5">{describeSide(side)}</p>
                                  {side.commands.length > 0 && (
                                    <p className="mt-1.5 text-[10px]" style={{ color: "var(--muted)" }}>
                                      recorded:{" "}
                                      {side.commands
                                        .map((cmd) => `${cmd.type.replaceAll(".", " ")}${cmd.resolution ? ` → ${cmd.resolution.replaceAll("_", " ")}` : ""}`)
                                        .join(" · ")}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                            <p className="mt-2 text-[10px]" style={{ color: "var(--muted)" }}>
                              Either way nothing posts or pays without a human approving it at the gateway — this compares the
                              recommendation quality, not what actually happened to the books.
                            </p>
                          </div>
                        </details>
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
