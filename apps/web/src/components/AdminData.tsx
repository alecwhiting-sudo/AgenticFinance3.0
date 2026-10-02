"use client";

/** Admin data controls: reset/reload instantly, clear to zero, or replay the
 * whole dataset live (paced) so the live feed and flow view show the books
 * being built from nothing. Polls /admin/status while a job runs. */
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

type Status = {
  counts: { purchases: number; invoices: number; journals: number; events: number; bank_lines: number; balance: string };
  job: { running: boolean; mode: string; done: number; total: number; message: string; error: string | null };
};

export default function AdminData() {
  const [s, setS] = useState<Status | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pace, setPace] = useState(120);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/status`);
      if (res.ok) setS((await res.json()) as Status);
    } catch {
      setErr(`Cannot reach the API at ${apiUrl}.`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // poll while a job runs
  useEffect(() => {
    if (!s?.job.running) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [s?.job.running, load]);

  const run = async (mode: string) => {
    setConfirm(null);
    setErr(null);
    try {
      const res = await fetch(`${apiUrl}/admin/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, paceMs: pace }),
      });
      if (!res.ok) setErr(((await res.json()) as { error?: string }).error ?? "failed");
    } catch {
      setErr(`Cannot reach the API at ${apiUrl}.`);
    }
    await load();
  };

  const btn = (label: string, mode: string, danger = false) =>
    confirm === mode ? (
      <span className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--bad)" }}>
          {mode === "zero" ? "Wipes ALL transactions." : "Wipes and rebuilds ALL transactions."} Sure?
        </span>
        <button
          onClick={() => run(mode)}
          className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: "var(--bad)" }}
        >
          Yes, {label.toLowerCase()}
        </button>
        <button
          onClick={() => setConfirm(null)}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)" }}
        >
          Cancel
        </button>
      </span>
    ) : (
      <button
        disabled={s?.job.running}
        onClick={() => setConfirm(mode)}
        className="whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
        style={{ borderColor: danger ? "var(--bad)" : "var(--border)", color: danger ? "var(--bad)" : undefined }}
      >
        {label}
      </button>
    );

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        Demo data
      </h3>

      {s && (
        <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {Object.entries({
            purchases: s.counts.purchases,
            invoices: s.counts.invoices,
            journals: s.counts.journals,
            events: s.counts.events,
            "bank lines": s.counts.bank_lines,
            "GL balance": Number(s.counts.balance) === 0 ? "✓ 0" : s.counts.balance,
          }).map(([k, v]) => (
            <div key={k} className="rounded-lg border p-2 text-center" style={{ borderColor: "var(--border)" }}>
              <div className="text-lg font-semibold tabular-nums">{v}</div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{k}</div>
            </div>
          ))}
        </div>
      )}

      {s?.job.running ? (
        <div className="space-y-2">
          <div className="text-sm">
            {s.job.mode === "replay" ? "Replaying from zero" : s.job.mode === "zero" ? "Clearing" : "Reloading"} —{" "}
            <span className="tabular-nums">{s.job.done}/{s.job.total || "…"}</span>{" "}
            <span style={{ color: "var(--muted)" }}>{s.job.message}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ background: "var(--accent)", width: s.job.total ? `${(s.job.done / s.job.total) * 100}%` : "10%" }}
            />
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Open the P2P live flow or the dashboard feed in another tab to watch.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {btn("Reset & reload", "reload")}
          {btn("Clear to zero", "zero", true)}
          <span className="flex items-center gap-2">
            {btn("Replay live from zero", "replay")}
            <label className="text-xs" style={{ color: "var(--muted)" }}>
              pace{" "}
              <select
                value={pace}
                onChange={(e) => setPace(Number(e.target.value))}
                className="rounded border p-1 text-xs"
                style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                <option value={60}>fast (~30s)</option>
                <option value={120}>brisk (~1min)</option>
                <option value={400}>deliberate (~2.5min)</option>
                <option value={1000}>slow (~5min)</option>
              </select>
            </label>
          </span>
          {s?.job.error && <span className="text-xs" style={{ color: "var(--bad)" }}>last job failed: {s.job.error.slice(0, 120)}</span>}
          {!s?.job.running && s?.job.message && !s.job.error && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>{s.job.message}</span>
          )}
          {err && <span className="text-xs" style={{ color: "var(--bad)" }}>{err}</span>}
        </div>
      )}
    </section>
  );
}
