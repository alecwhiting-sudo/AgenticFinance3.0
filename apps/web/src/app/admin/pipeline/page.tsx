"use client";

/** Mission control (plans/DEMO_SCRIPTS.md §4): the demo pipeline dashboard.
 * Backlog by month draining live, elapsed/throughput counters, the control
 * split (straight-through vs needs-judgement vs awaiting-human), integrity,
 * and the remembered runs for the baseline-vs-10x side-by-side. */
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

type MonthRow = {
  month: string;
  dataset: { ap: number; ar: number; bank: number; total: number };
  loaded: { ap: number; ar: number; bank: number; total: number };
};
type Pipeline = {
  months: MonthRow[];
  split: {
    ap_straight: number;
    ap_exceptions: number;
    ar_posted: number;
    bank_matched: number;
    bank_unmatched: number;
    agent_queue: number;
    awaiting_human: number;
  };
  integrity: { journals: number; events: number; balance: string };
  job: {
    running: boolean;
    mode: string;
    done: number;
    total: number;
    message: string;
    error: string | null;
    elapsedMs: number;
  };
  runs: {
    label: string;
    ms: number;
    items: number;
    monthLoaded: string | null;
    journals: number;
    balance: number;
    stats: Record<string, number>;
  }[];
};

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const perMin = (items: number, ms: number) => (ms > 0 ? Math.round((items / ms) * 60000) : 0);

export default function PipelinePage() {
  const [p, setP] = useState<Pipeline | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pace, setPace] = useState(120);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/pipeline`);
      if (res.ok) setP((await res.json()) as Pipeline);
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (mode: string, paceMs: number, label?: string) => {
    setConfirm(null);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/admin/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, paceMs, label }),
      });
      if (!res.ok) setMsg(((await res.json()) as { error?: string }).error ?? "failed");
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    await load();
  };

  const simulateDay = async () => {
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/admin/simulate-day`, { method: "POST" });
      const d = (await res.json()) as { dripped: { scenario: string; summary: string }[]; receipt: string | null };
      setMsg(
        `Morning simulated: ${d.dripped.map((x) => x.scenario).join(", ")}${d.receipt ? ` + receipt ${d.receipt}` : ""} — watch the live flow.`,
      );
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  };

  const busy = p?.job.running ?? false;
  const btnStyle = { borderColor: "var(--border)" };
  const btn = (label: string, onClick: () => void, opts?: { accent?: boolean; danger?: boolean; title?: string }) => (
    <button
      key={label}
      disabled={busy}
      onClick={onClick}
      title={opts?.title}
      className="whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
      style={{
        borderColor: opts?.danger ? "var(--bad)" : opts?.accent ? "var(--accent)" : btnStyle.borderColor,
        color: opts?.danger ? "var(--bad)" : opts?.accent ? "var(--accent)" : undefined,
      }}
    >
      {label}
    </button>
  );

  const straight = p ? p.split.ap_straight + p.split.ar_posted : 0;
  const maxMonth = p ? Math.max(...p.months.map((m) => m.dataset.total), 1) : 1;
  const totalDataset = p ? p.months.reduce((s, m) => s + m.dataset.total, 0) : 0;
  const totalLoaded = p ? p.months.reduce((s, m) => s + m.loaded.total, 0) : 0;

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Pipeline — mission control</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          The whole demo backlog and the machine working through it. {totalLoaded}/{totalDataset} transactions
          in the books.
        </p>
      </section>

      {/* actions */}
      <section className="flex flex-wrap items-center gap-3">
        {confirm ? (
          <span className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--bad)" }}>
              {confirm === "zero" ? "Wipes ALL transactions." : "Wipes and re-runs ALL transactions."} Sure?
            </span>
            <button
              onClick={() => (confirm === "zero" ? run("zero", 0) : run("replay", confirm === "fullspeed" ? 0 : pace))}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-white"
              style={{ background: "var(--bad)" }}
            >
              Yes, go
            </button>
            <button onClick={() => setConfirm(null)} className="rounded-lg border px-3 py-1.5 text-sm" style={btnStyle}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            {btn("Process next month", () => run("month", 60), {
              accent: true,
              title: "Loads the next unloaded dataset month through the full pipe",
            })}
            {btn("Run everything — full speed", () => setConfirm("fullspeed"), {
              title: "Wipes, then runs the whole dataset flat out with the timer on (the 10x run)",
            })}
            <span className="flex items-center gap-2">
              {btn("Replay all — paced", () => setConfirm("paced"), { title: "Wipes, then replays with live activity" })}
              <select
                value={pace}
                onChange={(e) => setPace(Number(e.target.value))}
                className="rounded border p-1 text-xs"
                style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                <option value={60}>fast</option>
                <option value={120}>brisk</option>
                <option value={400}>deliberate</option>
              </select>
            </span>
            {btn("Simulate a day", simulateDay, { title: "Drips a believable morning: clean, scan, exception, receipt" })}
            {btn("Clear to zero", () => setConfirm("zero"), { danger: true })}
          </>
        )}
        {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
        {p?.job.error && <span className="text-xs" style={{ color: "var(--bad)" }}>last job failed: {p.job.error.slice(0, 120)}</span>}
      </section>

      {/* live run counters */}
      {p && (busy || p.job.total > 0) && (
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: busy ? "var(--accent)" : "var(--border)", background: "var(--card)" }}
        >
          <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-sm font-medium">
              {busy ? `Running — ${p.job.mode}` : `Last run — ${p.job.mode}`}
            </span>
            <span className="text-2xl font-semibold tabular-nums">{p.job.done}<span className="text-sm font-normal" style={{ color: "var(--muted)" }}>/{p.job.total || "…"} items</span></span>
            <span className="text-2xl font-semibold tabular-nums">{mmss(p.job.elapsedMs)}<span className="text-sm font-normal" style={{ color: "var(--muted)" }}> elapsed</span></span>
            <span className="text-2xl font-semibold tabular-nums">{perMin(p.job.done, p.job.elapsedMs)}<span className="text-sm font-normal" style={{ color: "var(--muted)" }}> items/min</span></span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>{p.job.message}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ background: "var(--accent)", width: p.job.total ? `${(p.job.done / p.job.total) * 100}%` : busy ? "10%" : "100%" }}
            />
          </div>
        </section>
      )}

      {/* backlog by month */}
      {p && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Backlog by month — AP · AR · bank
          </h3>
          <div className="space-y-2">
            {p.months.map((m) => {
              const pct = m.dataset.total ? (m.loaded.total / m.dataset.total) * 100 : 0;
              return (
                <div key={m.month} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 tabular-nums">{m.month}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded" style={{ background: "var(--border)" }}>
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        background: pct >= 100 ? "var(--good)" : "var(--accent)",
                        width: `${(m.dataset.total / maxMonth) * pct}%`,
                        maxWidth: `${(m.dataset.total / maxMonth) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-40 shrink-0 text-right text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                    {m.loaded.total}/{m.dataset.total} · {m.dataset.ap} ap {m.dataset.ar} ar {m.dataset.bank} bk
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* control split + integrity */}
      {p && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { v: straight, l: "straight through", hint: "posted untouched" },
            { v: p.split.ap_exceptions, l: "exceptions open", hint: "need judgement" },
            { v: p.split.agent_queue, l: "agent queue", hint: "being worked" },
            { v: p.split.awaiting_human, l: "awaiting human", hint: "your approvals" },
            { v: `${p.split.bank_matched}/${p.split.bank_matched + p.split.bank_unmatched}`, l: "bank matched", hint: "" },
            { v: p.integrity.journals === p.integrity.events ? "✓" : `${p.integrity.journals}≠${p.integrity.events}`, l: "journals = events", hint: "" },
            { v: Number(p.integrity.balance) === 0 ? "✓ 0" : p.integrity.balance, l: "GL balance", hint: "" },
          ].map((s) => (
            <div key={s.l} className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="text-xl font-semibold tabular-nums">{s.v}</div>
              <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{s.l}</div>
              {s.hint && <div className="text-[10px]" style={{ color: "var(--muted)" }}>{s.hint}</div>}
            </div>
          ))}
        </section>
      )}

      {/* runs side-by-side */}
      {p && p.runs.length > 0 && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Runs this session — baseline vs the 10x run (memory clears on redeploy)
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className="py-2">Run</th>
                <th className="py-2 text-right">Items</th>
                <th className="py-2 text-right">Time</th>
                <th className="py-2 text-right">Items/min</th>
                <th className="py-2 text-right">Straight through</th>
                <th className="py-2 text-right">Exceptions</th>
                <th className="py-2 text-right">Journals</th>
                <th className="py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {p.runs.map((r, i) => (
                <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5">{r.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.items}</td>
                  <td className="py-1.5 text-right tabular-nums">{mmss(r.ms)}</td>
                  <td className="py-1.5 text-right tabular-nums">{perMin(r.items, r.ms)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {(r.stats.posted ?? 0) + (r.stats.arInvoices ?? 0)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.stats.exceptions ?? 0}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.journals}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.balance === 0 ? "✓ 0" : r.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            Throughput is measured on demo infrastructure — the honest claim is the shape: machine time
            scales with volume, human involvement scales only with genuine exceptions.
          </p>
        </section>
      )}
    </main>
  );
}
