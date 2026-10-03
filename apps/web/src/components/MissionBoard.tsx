"use client";

/** The pipeline board (plans/DEMO_SCRIPTS.md §4), as composable pieces so the
 * Test panel renders progress alongside the scenario being run: month lanes
 * per stream, the live activity list, the control/integrity tiles, and the
 * runs table. All read from one GET /admin/pipeline payload. */

export type Pipeline = {
  months: {
    month: string;
    dataset: { ap: number; ar: number; bank: number; total: number };
    loaded: { ap: number; ar: number; bank: number; total: number };
  }[];
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
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
};
export const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const perMin = (items: number, ms: number) => (ms > 0 ? Math.round((items / ms) * 60000) : 0);

const LANES: { key: "ap" | "ar" | "bank"; label: string }[] = [
  { key: "ap", label: "Supplier invoices" },
  { key: "ar", label: "Customer billing" },
  { key: "bank", label: "Bank feed" },
];

export function BoardLanes({ p }: { p: Pipeline }) {
  return (
    <div className="space-y-3">
      {LANES.map((lane) => {
        const max = Math.max(...p.months.map((m) => m.dataset[lane.key]), 1);
        return (
          <div key={lane.key} className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{lane.label}</h3>
            <div className="space-y-1">
              {p.months.map((m) => {
                const total = m.dataset[lane.key];
                const loaded = m.loaded[lane.key];
                const pct = total ? Math.min(loaded / total, 1) : 0;
                return (
                  <div key={m.month} className="flex items-center gap-2 text-sm">
                    <span className="w-16 shrink-0 text-xs tabular-nums">{monthLabel(m.month)}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded" style={{ background: "var(--border)" }}>
                      <div
                        className="h-full rounded transition-all"
                        style={{ background: pct >= 1 ? "var(--good)" : "var(--accent)", width: `${(total / max) * pct * 100}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums" style={{ color: "var(--muted)" }}>
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
  );
}

export function BoardTicker({ p, limit = 8 }: { p: Pipeline; limit?: number }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Activity</h3>
      <ul className="space-y-1.5">
        {p.recent.slice(0, limit).map((e, i) => (
          <li key={i} className="text-xs leading-5">
            <span className="tabular-nums" style={{ color: "var(--muted)" }}>
              {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>{" "}
            {e.summary}
          </li>
        ))}
        {p.recent.length === 0 && <li className="text-xs" style={{ color: "var(--muted)" }}>No recent activity.</li>}
      </ul>
    </div>
  );
}

export function BoardTiles({ p }: { p: Pipeline }) {
  const straight = p.split.ap_straight + p.split.ar_posted;
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      {[
        { v: straight, l: "straight through", hint: "no intervention" },
        { v: p.split.ap_exceptions, l: "exceptions open", hint: "awaiting review" },
        { v: p.split.agent_queue, l: "agent queue", hint: "being worked" },
        { v: p.split.awaiting_human, l: "awaiting human", hint: "approval decisions" },
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
          <div className="text-xl font-semibold tracking-tight">{s.v}</div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{s.l}</div>
          {s.hint && <div className="text-[10px]" style={{ color: "var(--muted)" }}>{s.hint}</div>}
        </div>
      ))}
    </section>
  );
}

export function BoardRuns({ p }: { p: Pipeline }) {
  if (p.runs.length === 0) return null;
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        Runs this session (memory clears on redeploy)
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
              <td className="py-1.5 text-right tabular-nums">{(r.stats.posted ?? 0) + (r.stats.arInvoices ?? 0)}</td>
              <td className="py-1.5 text-right tabular-nums">{r.stats.exceptions ?? 0}</td>
              <td className="py-1.5 text-right tabular-nums">{r.journals}</td>
              <td className="py-1.5 text-right tabular-nums">{r.balance === 0 ? "✓ 0" : r.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Throughput is measured on demo infrastructure. Processing time scales with volume; human
        review scales with the exception rate.
      </p>
    </section>
  );
}
