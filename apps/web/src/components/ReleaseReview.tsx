"use client";

/** AI release review (plans/RELEASE_GOVERNANCE.md M3b): the advisory opinion
 * the Release Reviewer agent writes from a draft's measured evidence, shown
 * beside the promote decision. Advisory only — the human still decides, and
 * a review without a shadow replay behind it says so ("predicted, not
 * measured"). Reviews are also requested automatically when a shadow replay
 * completes, so by the time someone looks at Promote an opinion is usually
 * already here. */
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

type ReviewBody = {
  headline?: string;
  behaviourChange?: string;
  controlImpact?: string;
  robustness?: string;
  recommendation?: string;
  caveats?: string[];
};
type Review = {
  id: string;
  status: string; // running | complete | failed
  verdict: string | null; // recommend_promote | recommend_hold | insufficient_evidence
  grounded: boolean;
  body: ReviewBody | null;
  draftVersion: number | null;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
};

const VERDICT_LABEL: Record<string, string> = {
  recommend_promote: "Recommends promoting",
  recommend_hold: "Recommends HOLDING",
  insufficient_evidence: "Not enough evidence",
};
const VERDICT_TONE: Record<string, string> = {
  recommend_promote: "var(--good)",
  recommend_hold: "var(--bad)",
  insufficient_evidence: "var(--warn)",
};

export default function ReleaseReviewPanel({
  agentSlug,
  draftVersions,
}: {
  agentSlug: string;
  draftVersions: number[];
}) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [version, setVersion] = useState<number | undefined>(draftVersions[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiUrl}/agents/${agentSlug}/reviews`);
      if (r.ok) setReviews(((await r.json()) as { reviews: Review[] }).reviews);
    } catch {
      /* retry on next poll */
    }
  }, [agentSlug]);
  useEffect(() => {
    void load();
  }, [load]);
  const running = (reviews ?? []).some((r) => r.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  const latest = reviews?.[0] ?? null;
  const body = latest?.body ?? null;

  return (
    <div data-tour="release-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">AI release review</h3>
          <p className="max-w-3xl text-xs" style={{ color: "var(--muted)" }}>
            The Release Reviewer agent reads this agent&apos;s draft evidence — the eval suite, any
            dropped control lines, and the shadow-replay measurements when they exist — and writes a
            second opinion for the promote decision. It is advisory: it never promotes or blocks, and
            an opinion with no measurements behind it is labelled <em>predicted, not measured</em>.
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
                    const r = await fetch(`${apiUrl}/agents/${agentSlug}/releases/${version}/review`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ createdBy: "workbench" }),
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
                {busy ? "Starting…" : running ? "Reviewing…" : "Request AI review"}
              </button>
            </>
          ) : (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              needs a draft release to review
            </span>
          )}
        </span>
      </div>
      {msg && <p className="mt-1 text-xs" style={{ color: "var(--bad)" }}>{msg}</p>}

      {latest && (
        <div className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {latest.status === "running" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
                reviewing draft v{latest.draftVersion}…
              </span>
            ) : latest.status === "failed" ? (
              <span style={{ color: "var(--bad)" }}>review of draft v{latest.draftVersion} failed — request it again</span>
            ) : (
              <>
                <span
                  className="rounded-full px-2 py-0.5 font-semibold"
                  style={{
                    color: VERDICT_TONE[latest.verdict ?? ""] ?? "var(--muted)",
                    background: `color-mix(in srgb, ${VERDICT_TONE[latest.verdict ?? ""] ?? "var(--muted)"} 12%, transparent)`,
                  }}
                >
                  {VERDICT_LABEL[latest.verdict ?? ""] ?? latest.verdict}
                </span>
                <span
                  className="rounded-full border px-2 py-0.5"
                  style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                  title={latest.grounded ? "Reconciled to shadow-replay measurements" : "No shadow replay behind this opinion"}
                >
                  {latest.grounded ? "grounded in measured replay" : "predicted, not measured"}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  draft v{latest.draftVersion} · {latest.finishedAt ? new Date(latest.finishedAt).toLocaleString() : ""} ·{" "}
                  requested by {latest.createdBy === "shadow-replay" ? "the replay (automatic)" : latest.createdBy}
                </span>
              </>
            )}
          </div>
          {latest.status === "complete" && body && (
            <div className="mt-2 space-y-2 text-xs leading-5">
              <p className="text-sm font-medium">{body.headline}</p>
              {(
                [
                  ["What would change", body.behaviourChange],
                  ["Controls", body.controlImpact],
                  ["Test evidence", body.robustness],
                  ["Recommendation", body.recommendation],
                ] as const
              ).map(([label, text]) =>
                text ? (
                  <p key={label}>
                    <span className="font-semibold">{label}: </span>
                    <span style={{ color: "var(--muted)" }}>{text}</span>
                  </p>
                ) : null,
              )}
              {(body.caveats ?? []).length > 0 && (
                <ul className="list-disc pl-4" style={{ color: "var(--warn)" }}>
                  {body.caveats!.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              <p style={{ color: "var(--muted)" }}>
                The promote decision stays with you — this opinion is recorded on the release&apos;s audit trail either way.
              </p>
            </div>
          )}
        </div>
      )}
      {reviews !== null && reviews.length === 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          No reviews yet. One is requested automatically when a shadow replay finishes, or request one now.
        </p>
      )}
    </div>
  );
}
