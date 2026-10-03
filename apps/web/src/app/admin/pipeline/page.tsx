"use client";

/** Mission control (plans/DEMO_SCRIPTS.md §4): the demo pipeline dashboard.
 * Three named lanes (supplier invoices / customer billing / bank feed)
 * draining by month, a live ticker of real names and amounts, elapsed and
 * throughput counters, the control split, a plain-English end-of-run
 * receipt, and today's actual model spend (the big runs are deterministic —
 * 0 model calls). */
import Link from "next/link";
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
  nextMonth: string | null;
  modelSpend: { runs: number; tokens: number; costCents: number };
  recent: { at: string; summary: string }[];
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
    mode: string;
    ms: number;
    items: number;
    monthLoaded: string | null;
    journals: number;
    balance: number;
    stats: Record<string, number>;
  }[];
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
};
const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const perMin = (items: number, ms: number) => (ms > 0 ? Math.round((items / ms) * 60000) : 0);

const LANES: { key: "ap" | "ar" | "bank"; label: string; blurb: string }[] = [
  { key: "ap", label: "Supplier invoices", blurb: "captured, matched to PO + receipt, posted, paid" },
  { key: "ar", label: "Customer billing", blurb: "invoices raised, revenue posted, receipts applied" },
  { key: "bank", label: "Bank feed", blurb: "statement lines reconciled against the books" },
];

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
  const btn = (label: string, onClick: () => void, opts?: { accent?: boolean; danger?: boolean; title?: string; disabled?: boolean }) => (
    <button
      key={label}
      disabled={busy || opts?.disabled}
      onClick={onClick}
      title={opts?.title}
      className="whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
      style={{
        borderColor: opts?.danger ? "var(--bad)" : opts?.accent ? "var(--accent)" : "var(--border)",
        color: opts?.danger ? "var(--bad)" : opts?.accent ? "var(--accent)" : undefined,
      }}
    >
      {label}
    </button>
  );

  const straight = p ? p.split.ap_straight + p.split.ar_posted : 0;
  const totalDataset = p ? p.months.reduce((s, m) => s + m.dataset.total, 0) : 0;
  const totalLoaded = p ? p.months.reduce((s, m) => s + m.loaded.total, 0) : 0;
  const lastRun = p?.runs[0] ?? null;

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
              {confirm === "zero"
                ? "Wipes ALL transactions."
                : confirm === "cold-all"
                  ? "Wipes everything, then queues ~300 supplier invoices for REAL agent extraction (~20–30 min, a few $ of model calls)."
                  : "Wipes and re-runs ALL transactions."}{" "}
              Sure?
            </span>
            <button
              onClick={() =>
                confirm === "zero"
                  ? run("zero", 0)
                  : confirm === "cold-all"
                    ? run("cold-all", 0)
                    : run("replay", confirm === "fullspeed" ? 0 : pace)
              }
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-white"
              style={{ background: "var(--bad)" }}
            >
              Yes, go
            </button>
            <button onClick={() => setConfirm(null)} className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)" }}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            {btn(
              p?.nextMonth ? `Process ${monthLabel(p.nextMonth)} →` : "All months in the books ✓",
              () => run("month", 60),
              {
                accent: true,
                disabled: !p?.nextMonth,
                title: "Loads the next month's transactions through the full pipe — no model calls",
              },
            )}
            {btn("Run remaining months", () => run("months", 60), {
              disabled: !p?.nextMonth,
              title: "Processes every remaining month, pausing briefly at each month boundary — no model calls",
            })}
            {btn(
              p?.nextMonth ? `From scratch: ${monthLabel(p.nextMonth)} (agents extract)` : "From scratch (agents extract)",
              () => run("cold", 0),
              {
                disabled: !p?.nextMonth,
                title:
                  "Internal records load as system data; the month's supplier invoices land as unread documents the Invoice Extraction Agent processes one by one — real model calls (Haiku tier, pennies), ~3–5 min per month",
              },
            )}
            {btn("Everything from scratch", () => setConfirm("cold-all"), {
              title: "Wipes, then queues all ~300 supplier invoices for real agent extraction — ~20–30 min, a few $ of model calls",
            })}
            {btn("Run everything — full speed", () => setConfirm("fullspeed"), {
              title: "Wipes, then runs the whole dataset flat out with the timer on (the 10x run) — no model calls",
            })}
            <span className="flex items-center gap-2">
              {btn("Replay all — paced", () => setConfirm("paced"), { title: "Wipes, then replays with live activity — no model calls" })}
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
            {btn("Simulate a day", simulateDay, { title: "Drips a believable morning into the agent queue — a few Haiku-tier model calls, pennies" })}
            {btn("Clear to zero", () => setConfirm("zero"), { danger: true })}
          </>
        )}
        {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
        {p?.job.error && <span className="text-xs" style={{ color: "var(--bad)" }}>last job failed: {p.job.error.slice(0, 120)}</span>}
      </section>

      {/* live run counters */}
      {p && busy && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-sm font-medium">Running — {p.job.mode}</span>
            <span className="text-2xl font-semibold tabular-nums">
              {p.job.done}
              <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>/{p.job.total || "…"} items</span>
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {mmss(p.job.elapsedMs)}
              <span className="text-sm font-normal" style={{ color: "var(--muted)" }}> elapsed</span>
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {perMin(p.job.done, p.job.elapsedMs)}
              <span className="text-sm font-normal" style={{ color: "var(--muted)" }}> items/min</span>
            </span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>{p.job.message}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ background: "var(--accent)", width: p.job.total ? `${(p.job.done / p.job.total) * 100}%` : "10%" }}
            />
          </div>
        </section>
      )}

      {/* end-of-run receipt (plain English) */}
      {p && !busy && lastRun && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Last run — {lastRun.label}
          </h3>
          {(lastRun.stats.queued ?? 0) > 0 ? (
            <p className="text-sm leading-6">
              Cold start: <span className="font-semibold tabular-nums">{lastRun.stats.queued}</span> supplier invoices
              landed as unread documents — the Invoice Extraction Agent is reading each one (watch the agent queue
              tile and the ticker). Internal records ({lastRun.stats.purchases ?? 0} purchases,{" "}
              {lastRun.stats.receipts ?? 0} receipts, {lastRun.stats.arInvoices ?? 0} customer invoices) loaded as
              system data. Once the queue drains, run payments from the P2P payments page.
            </p>
          ) : (
            <p className="text-sm leading-6">
              <span className="font-semibold tabular-nums">{lastRun.items}</span> transactions processed in{" "}
              <span className="font-semibold tabular-nums">{mmss(lastRun.ms)}</span>
              {" "}({perMin(lastRun.items, lastRun.ms)} per minute, no model calls — the machine is deterministic code).{" "}
              <span className="font-semibold tabular-nums">{(lastRun.stats.posted ?? 0) + (lastRun.stats.arInvoices ?? 0)}</span> went
              straight through untouched. <span className="font-semibold tabular-nums">{lastRun.stats.exceptions ?? 0}</span> fired
              exceptions that need judgement. The books balanced the whole way:{" "}
              {lastRun.balance === 0 ? "✓ 0" : lastRun.balance}.
            </p>
          )}
          <p className="mt-2 text-sm">
            <Link href="/p2p" className="hover:underline" style={{ color: "var(--accent)" }}>
              {p.split.ap_exceptions} exceptions open →
            </Link>
            <span className="mx-3" style={{ color: "var(--muted)" }}>·</span>
            <Link href="/decisions" className="hover:underline" style={{ color: "var(--accent)" }}>
              {p.split.awaiting_human} waiting for your approval →
            </Link>
          </p>
        </section>
      )}

      {/* three named lanes + live ticker */}
      {p && (
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {LANES.map((lane) => {
              const max = Math.max(...p.months.map((m) => m.dataset[lane.key]), 1);
              return (
                <div key={lane.key} className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <div className="mb-2 flex items-baseline gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide">{lane.label}</h3>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>{lane.blurb}</span>
                  </div>
                  <div className="space-y-1.5">
                    {p.months.map((m) => {
                      const total = m.dataset[lane.key];
                      const loaded = m.loaded[lane.key];
                      const pct = total ? Math.min(loaded / total, 1) : 0;
                      return (
                        <div key={m.month} className="flex items-center gap-3 text-sm">
                          <span className="w-20 shrink-0 text-xs tabular-nums">{monthLabel(m.month)}</span>
                          <div className="h-3.5 flex-1 overflow-hidden rounded" style={{ background: "var(--border)" }}>
                            <div
                              className="h-full rounded transition-all"
                              style={{
                                background: pct >= 1 ? "var(--good)" : "var(--accent)",
                                width: `${(total / max) * pct * 100}%`,
                              }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                            {loaded}/{total}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Happening now
            </h3>
            <ul className="space-y-2">
              {p.recent.map((e, i) => (
                <li key={i} className="text-sm leading-5">
                  <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                    {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>{" "}
                  {e.summary}
                </li>
              ))}
              {p.recent.length === 0 && (
                <li className="text-sm" style={{ color: "var(--muted)" }}>Quiet — run something.</li>
              )}
            </ul>
          </div>
        </section>
      )}

      {/* control split + integrity + model spend */}
      {p && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {[
            { v: straight, l: "straight through", hint: "posted untouched" },
            { v: p.split.ap_exceptions, l: "exceptions open", hint: "need judgement" },
            { v: p.split.agent_queue, l: "agent queue", hint: "being worked" },
            { v: p.split.awaiting_human, l: "awaiting human", hint: "your approvals" },
            { v: `${p.split.bank_matched}/${p.split.bank_matched + p.split.bank_unmatched}`, l: "bank matched", hint: "" },
            { v: p.integrity.journals === p.integrity.events ? "✓" : `${p.integrity.journals}≠${p.integrity.events}`, l: "journals = events", hint: "" },
            { v: Number(p.integrity.balance) === 0 ? "✓ 0" : p.integrity.balance, l: "GL balance", hint: "" },
            {
              v: `$${(p.modelSpend.costCents / 100).toFixed(2)}`,
              l: "model spend today",
              hint: `${p.modelSpend.runs} agent runs · ${(p.modelSpend.tokens / 1000).toFixed(0)}k tok`,
            },
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
            Runs this session — baseline vs the 10x run (cold starts spend model tokens; the rest are 0 model calls · memory clears on redeploy)
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
