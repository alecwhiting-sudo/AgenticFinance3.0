"use client";

/** Board packs home (plans/DATASET_V2.md PR-G): THE known place for the
 * product. Pick a period window, draft, and the pack lives here — a
 * drafting pack keeps working if you leave the page and is waiting when
 * you return (the row and the agent run are server-side). If a pack reads
 * wrong, the fix is the governed loop: edit the Board pack method skill,
 * let the eval gate pass it, re-draft. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { Button } from "@/components/ui";

type PackRow = {
  id: string;
  label: string;
  title: string;
  status: "drafting" | "draft" | "failed";
  lensGrain: string;
  periodFrom: string;
  periodTo: string;
  sections: number;
  createdAt: string;
  updatedAt: string;
};

const monthLabel = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const quarterOf = (p: string) => `${p.slice(0, 4)}-Q${Math.ceil(Number(p.slice(5, 7)) / 3)}`;

export default function BoardPacksPage() {
  const [packs, setPacks] = useState<PackRow[] | null>(null);
  const [periods, setPeriods] = useState<string[]>([]);
  const [grain, setGrain] = useState<"month" | "quarter" | "ytd">("month");
  const [anchor, setAnchor] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = (await (await fetch(`${apiUrl}/r2r/board-packs`)).json()) as { packs: PackRow[] };
      setPacks(d.packs);
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  }, []);

  useEffect(() => {
    void load();
    void fetch(`${apiUrl}/analytics/flux`)
      .then((r) => r.json())
      .then((d: { periods?: string[] }) => {
        const ps = d.periods ?? [];
        setPeriods(ps);
        if (ps.length) setAnchor(ps[ps.length - 1]!);
      })
      .catch(() => {});
  }, [load]);

  // a drafting pack refreshes itself — and survives the page being closed
  const anyDrafting = packs?.some((p) => p.status === "drafting") ?? false;
  useEffect(() => {
    if (!anyDrafting) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [anyDrafting, load]);

  const lensFor = () => (grain === "month" ? anchor : grain === "quarter" ? quarterOf(anchor) : `ytd@${anchor}`);
  const lensLabel = () =>
    grain === "month" ? monthLabel(anchor) : grain === "quarter" ? `${quarterOf(anchor).slice(5)} ${anchor.slice(0, 4)}` : `YTD ${monthLabel(anchor)}`;

  const draft = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/r2r/board-packs/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lens: lensFor() }),
      });
      const d = (await res.json()) as { packId?: string; label?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "draft failed");
      setMsg(`Drafting the ${d.label} pack — it keeps working if you leave this page.`);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const statusChip = (s: PackRow["status"]) =>
    s === "drafting" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
        drafting…
      </span>
    ) : s === "draft" ? (
      <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium" style={{ borderColor: "var(--good)", color: "var(--good)" }}>
        ready for review
      </span>
    ) : (
      <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
        failed — draft again
      </span>
    );

  return (
    <main className="max-w-4xl space-y-6">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Board packs</h2>
        <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
          The decision-ready finance pack for a chosen period, drafted by the Board Reporting Agent
          from the governed views — actuals only, every figure traceable, the controls posture
          included. A human reviews every pack here before it goes anywhere. Packs are kept on this
          page permanently; a pack that is still drafting carries on if you leave and will be
          waiting when you come back.
        </p>
      </section>

      {/* draft control */}
      <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Draft a pack:</span>
          <div className="flex overflow-hidden rounded-lg border text-xs" style={{ borderColor: "var(--border)" }}>
            {(["month", "quarter", "ytd"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGrain(g)}
                className="px-2.5 py-1 capitalize"
                style={grain === g ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", fontWeight: 500 } : { color: "var(--muted)" }}
              >
                {g === "ytd" ? "YTD" : g}
              </button>
            ))}
          </div>
          <select
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            aria-label={grain === "month" ? "Month" : grain === "quarter" ? "Quarter (by its end month)" : "YTD through"}
            className="rounded-lg border px-2 py-1 text-xs"
            style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--foreground)" }}
          >
            {periods.map((m) => (
              <option key={m} value={m}>
                {grain === "month" ? monthLabel(m) : grain === "quarter" ? `${quarterOf(m).slice(5)} ${m.slice(0, 4)} (via ${monthLabel(m)})` : `YTD ${monthLabel(m)}`}
              </option>
            ))}
          </select>
          <span data-tour="draft-board-pack">
            <Button onClick={() => void draft()} disabled={busy || !anchor} variant="primary">
              Draft board pack — {anchor ? lensLabel() : "…"}
            </Button>
          </span>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Takes seconds without a model key (deterministic figures), a minute or two with one
          (narrative judgement). You do not need to stay on this page.
        </p>
      </section>

      {msg && <p className="text-sm" style={{ color: "var(--muted)" }}>{msg}</p>}

      {/* the known place: every pack, newest first */}
      <section className="space-y-2">
        {packs === null && <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>}
        {packs?.length === 0 && (
          <p className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            No packs yet — draft the first one above.
          </p>
        )}
        {packs?.map((p) => (
          <Link
            key={p.id}
            href={`/reports/board/${p.id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-4 transition-colors hover:border-[var(--accent)]"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <div>
              <div className="text-sm font-medium">{p.title}</div>
              <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                {p.lensGrain === "month" ? "Month" : p.lensGrain === "quarter" ? "Quarter" : "Year to date"} · requested{" "}
                {new Date(p.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {p.status === "draft" ? ` · ${p.sections} sections` : ""}
              </div>
            </div>
            {statusChip(p.status)}
          </Link>
        ))}
      </section>

      {/* the governed improvement loop, made visible */}
      <section className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Not happy with a pack?
        </h3>
        <p className="mt-1" style={{ color: "var(--muted)" }}>
          The pack's shape and tone live in the{" "}
          <Link href="/agents/skills" className="hover:underline" style={{ color: "var(--accent)" }}>
            Board pack method skill
          </Link>{" "}
          — edit it there (a new version goes through the eval gate before the agent uses it), then
          draft the period again. Work in progress is normal: the agent improves as the skill does.
        </p>
      </section>
    </main>
  );
}
