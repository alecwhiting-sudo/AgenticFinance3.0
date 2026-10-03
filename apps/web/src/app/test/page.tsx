"use client";

/** The Test panel (demo land, deliberately separate from the finance
 * product): a catalog of scenarios a CFO can read BEFORE running — what each
 * one does, what data it uses, what it proves and what it deliberately does
 * NOT prove, what it costs and how long it takes. Selecting a scenario shows
 * the detail (right panel on wide screens); Run buttons drive the same
 * endpoints as mission control, which stays the live board. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { Button } from "@/components/ui";
import { BoardLanes, BoardRuns, BoardTicker, BoardTiles, monthLabel, mmss, type Pipeline } from "@/components/MissionBoard";

type Action = {
  label: string;
  run: { kind: "reset"; mode: string; paceMs?: number } | { kind: "day"; scope: string } | { kind: "drip"; scenario: string };
  danger?: boolean;
  needsNextMonth?: boolean;
  /** true = wipes the books first; false = builds on what's already loaded */
  wipes?: boolean;
};

type NextStep = { label: string; href: string; count?: "exceptions" | "approvals" | "queue" };

type Dataset = {
  months: { month: string; ap: number; ar: number; bank: number }[];
  ap: { chains: number; goodsReceipts: number; formats: Record<string, number>; plantedExceptions: Record<string, number> };
  ar: { invoices: number; contracts: number; remittances: number };
  bank: { lines: number; kinds: Record<string, number> };
  masters: { suppliers: number; customers: number };
};

type Scenario = {
  id: string;
  title: string;
  tagline: string;
  cost: string;
  duration: string;
  does: string;
  uses: string;
  proves: string[];
  notProves: string[];
  actions: Action[];
  /** post-run guidance: concrete next steps with live counters */
  next: NextStep[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "months",
    title: "Run the year, month by month",
    tagline: "Process the dataset one month at a time, pausing at each close for review.",
    cost: "£0 — no model calls (deterministic processing)",
    duration: "~2s per month instant · pauses at each close in auto mode",
    does:
      "Processes one month's transactions through the full pipeline — purchases, receipts, supplier invoices matched and posted, customer billing, bank feed — then stops. Between months you inspect: run month-end, read the P&L, check the exceptions queue, draft the close commentary. 'Run remaining months' advances automatically with a pause at each boundary.",
    uses: "The committed Brightline dataset, in date order: ~120 transactions a month across AP, AR and bank, with planted exceptions.",
    proves: [
      "The close discipline: month-end accruals post and reverse through the same pipe as everything else",
      "Books balance at every stopping point — GL to zero, journals = events",
      "Exceptions accumulate and await review",
      "Statements and commentary reflect what has been processed to date",
    ],
    notProves: [
      "Document extraction — invoices load from structured data here (see 'From scratch')",
      "Agent decision-making — this is the deterministic machine; agents act on exceptions you hand them",
    ],
    actions: [
      { label: "Process next month", run: { kind: "reset", mode: "month", paceMs: 60 }, needsNextMonth: true, wipes: false },
      { label: "Run remaining months (auto)", run: { kind: "reset", mode: "months", paceMs: 60 }, needsNextMonth: true, wipes: false },
    ],
    next: [
      { label: "Run month-end: accruals post, then read the close dashboard", href: "/r2r" },
      { label: "Statements reflect the months processed so far", href: "/reports" },
      { label: "Open exceptions — review in the workbench", href: "/p2p/exceptions", count: "exceptions" },
      { label: "Approvals awaiting decision", href: "/approvals", count: "approvals" },
    ],
  },
  {
    id: "tenx",
    title: "The 10x stress test",
    tagline: "The full dataset processed as a single month's workload, timed.",
    cost: "£0 — no model calls",
    duration: "baseline ~2s · full run ~15–60s, timed live",
    does:
      "Two runs, side by side: first a single month as the baseline, then the entire dataset — ten months' volume — processed as one batch at full speed, timed. The runs table on mission control shows both: items, duration, throughput, and the human-review count, which scales with the exception rate rather than the volume.",
    uses: "The full dataset as one batch: 300 supplier invoice chains, 400 customer invoices, 508 bank lines, 36 planted exceptions (~12%).",
    proves: [
      "Deterministic processing scales linearly, with no model cost",
      "Human review scales with the exception rate (36 of ~1,200 items)",
      "Balanced books and journal/event parity maintained at full speed",
    ],
    notProves: [
      "Document extraction (structured data, not reading PDFs — see 'From scratch')",
      "Absolute throughput — timings reflect demo infrastructure; the scaling behaviour is the result, not the figure",
    ],
    actions: [
      { label: "1 · Baseline month", run: { kind: "reset", mode: "month", paceMs: 0 }, needsNextMonth: true, wipes: false },
      { label: "2 · Run 10x — full speed", run: { kind: "reset", mode: "replay", paceMs: 0 }, danger: true, wipes: true },
    ],
    next: [
      { label: "Baseline vs full run, side by side in the runs table below", href: "/test" },
      { label: "Open exceptions — review in the workbench", href: "/p2p/exceptions", count: "exceptions" },
      { label: "Approvals awaiting decision", href: "/approvals", count: "approvals" },
      { label: "Statements — every figure drills to its source", href: "/reports" },
    ],
  },
  {
    id: "cold",
    title: "From scratch — agents read every document",
    tagline: "Supplier invoices arrive as unread documents and are extracted by the agents.",
    cost: "~50–70p per month · ~£3–4 for everything (Haiku-tier extraction, metered live)",
    duration: "~3–5 min per month · ~20–30 min for everything",
    does:
      "Internal records (purchases, goods receipts, customer billing, bank feed) load as system data — they are internal records. Supplier invoices arrive as unread documents: the Invoice Extraction Agent extracts each one — text PDFs and e-invoices from their content, scanned images by vision — proposes the capture, and the pipeline matches, posts or raises an exception. Suppliers are promoted to learned templates as extractions validate. Payments are then run from the payments page.",
    uses: "The same dataset, but AP invoices as documents in the capture queue; the 'model spend today' tile meters the real cost.",
    proves: [
      "Model-based extraction, including vision on scans with no text layer",
      "The control chain: agent proposes → gateway validates → deterministic match decides",
      "Learned templates (D15): repeat suppliers move to deterministic extraction, reducing model cost over time",
      "Cost per document, measured from recorded token usage",
    ],
    notProves: [
      "Payment execution (deliberately left for your click — money never moves itself)",
      "Bank reconciliation of those payments until you run them",
    ],
    actions: [
      { label: "From scratch: next month", run: { kind: "reset", mode: "cold", paceMs: 0 }, needsNextMonth: true, wipes: false },
      { label: "Everything from scratch", run: { kind: "reset", mode: "cold-all", paceMs: 0 }, danger: true, wipes: true },
    ],
    next: [
      { label: "Follow the agents working through the queue", href: "/work", count: "queue" },
      { label: "Learned templates forming on the P2P page", href: "/p2p" },
      { label: "Exceptions raised by extraction — review in the workbench", href: "/p2p/exceptions", count: "exceptions" },
      { label: "Run the resulting payments", href: "/p2p/payments" },
      { label: "Measured model cost — the spend tile", href: "/test" },
    ],
  },
  {
    id: "replay",
    title: "Replay the full history",
    tagline: "Ten months of history replayed into a new system of record.",
    cost: "£0 — no model calls",
    duration: "~30s–5min depending on pace",
    does:
      "Wipes the books, then replays the complete ten-month history in date order — dates respected, every month landing as it originally happened — with the live feed narrating. Running it again produces identical books — the replay guarantee (D13).",
    uses: "The full dataset in chronological order, payments and receipts included (history contains its own settlements).",
    proves: [
      "Replay determinism (D13): same events, same books, every time",
      "The migration/cutover case: historical data loaded into a new system of record",
      "All controls live under continuous load: immutability, balance enforcement, idempotency",
    ],
    notProves: ["Document extraction (structured data)", "Day-to-day operational pacing — this is history replayed at demo speed"],
    actions: [{ label: "Replay everything — paced", run: { kind: "reset", mode: "replay", paceMs: 120 }, danger: true, wipes: true }],
    next: [
      { label: "Drill any statement number to its source event", href: "/reports" },
      { label: "Trial balance — journals = events, GL to zero", href: "/ledger" },
      { label: "Re-run from the board to verify identical results", href: "/test" },
    ],
  },
  {
    id: "day",
    title: "Simulate a day",
    tagline: "A small batch of new items, processed live.",
    cost: "~2–4p (a few Haiku-tier extractions)",
    duration: "~1 minute of agent work",
    does:
      "Adds a representative set of new items: a clean e-invoice, a scanned PDF extracted by vision, one exception (random — price variance, short receipt, missing receipt, unknown supplier or a bank-detail-change email), and a customer receipt investigation when one is available. Progress shows on the live flow; decisions land in the approvals inbox.",
    uses: "Fresh synthetic items against the loaded books — needs data loaded first.",
    proves: [
      "The daily experience end to end: arrive → extract → match → exception → human approval",
      "Fraud screening: the bank-detail-change email is flagged, never actioned",
      "Human involvement is limited to the approval decisions",
    ],
    notProves: ["Volume (that's the 10x run)", "The close (that's month by month)"],
    actions: [
      { label: "Simulate a day — everything", run: { kind: "day", scope: "all" }, wipes: false },
      { label: "Just P2P", run: { kind: "day", scope: "p2p" }, wipes: false },
      { label: "Just O2C", run: { kind: "day", scope: "o2c" }, wipes: false },
    ],
    next: [
      { label: "Follow the items on the live flow", href: "/p2p/flow" },
      { label: "Agents working now", href: "/work", count: "queue" },
      { label: "The exception's case — explore and resolve it in the workbench", href: "/p2p/exceptions", count: "exceptions" },
      { label: "Approve or reject pending items (including the dunning letter)", href: "/approvals", count: "approvals" },
    ],
  },
  {
    id: "drip",
    title: "Single transactions",
    tagline: "Drop one specific scenario in and follow it.",
    cost: "~1–1.5p each",
    duration: "seconds",
    does:
      "Lands one invoice of a chosen shape in the capture queue, exactly as inbound mail would. Useful for demonstrating one mechanism on demand, e.g. a short-shipped delivery.",
    uses: "A synthetic invoice (and purchase/receipt as the scenario requires) against a random supplier.",
    proves: ["One mechanism at a time, on demand"],
    notProves: ["Anything at volume"],
    actions: [
      { label: "Clean — straight through", run: { kind: "drip", scenario: "clean" } },
      { label: "Scanned document (vision)", run: { kind: "drip", scenario: "scan_document" } },
      { label: "Price variance", run: { kind: "drip", scenario: "price_variance" } },
      { label: "Short receipt", run: { kind: "drip", scenario: "qty_short_receipt" } },
      { label: "Missing receipt", run: { kind: "drip", scenario: "missing_receipt" } },
      { label: "No purchase record", run: { kind: "drip", scenario: "no_purchase" } },
      { label: "Bank-detail change (fraud screen)", run: { kind: "drip", scenario: "bank_detail_change" } },
    ],
    next: [
      { label: "Follow it on the live flow", href: "/p2p/flow" },
      { label: "The agent's run transcript", href: "/work" },
      { label: "If it fired an exception, resolve it in the workbench", href: "/p2p/exceptions", count: "exceptions" },
    ],
  },
  {
    id: "zero",
    title: "Clear to zero",
    tagline: "Clears all transaction data.",
    cost: "£0",
    duration: "instant",
    does:
      "Wipes all transactions — documents, journals, events, pending approvals and open cases. Master data, agents, their skills, run history and learned templates survive.",
    uses: "Nothing — it removes.",
    proves: ["Nothing — a utility action"],
    notProves: [],
    actions: [{ label: "Clear to zero", run: { kind: "reset", mode: "zero" }, danger: true, wipes: true }],
    next: [{ label: "Select a scenario to load data", href: "/test" }],
  },
];


export default function TestPage() {
  const [p, setP] = useState<Pipeline | null>(null);
  const [ds, setDs] = useState<Dataset | null>(null);
  const [showData, setShowData] = useState(false);
  const [sel, setSel] = useState<string>(SCENARIOS[0]!.id);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const [wasRunning, setWasRunning] = useState(false);

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
    void fetch(`${apiUrl}/admin/dataset`)
      .then((r) => r.json())
      .then((d) => setDs(d as Dataset))
      .catch(() => {});
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  // run just completed → light up the "where to go next" guidance
  useEffect(() => {
    const running = p?.job.running ?? false;
    if (wasRunning && !running && !p?.job.error) setJustFinished(true);
    setWasRunning(running);
  }, [p?.job.running, p?.job.error, wasRunning]);

  const fire = async (a: Action) => {
    setConfirm(null);
    setMsg(null);
    try {
      if (a.run.kind === "reset") {
        const res = await fetch(`${apiUrl}/admin/reset`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: a.run.mode, paceMs: a.run.paceMs ?? 0 }),
        });
        if (!res.ok) setMsg(((await res.json()) as { error?: string }).error ?? "failed");
        else setMsg("Started — follow it below or on the mission control board.");
      } else if (a.run.kind === "day") {
        const res = await fetch(`${apiUrl}/admin/simulate-day`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: a.run.scope }),
        });
        const d = (await res.json()) as { dripped: { scenario: string }[]; receipt: string | null; chased: string | null };
        setMsg(
          `Morning landed${d.dripped.length ? `: ${d.dripped.map((x) => x.scenario).join(", ")}` : ""}${d.receipt ? ` + receipt ${d.receipt}` : ""}${d.chased ? ` + chasing ${d.chased}` : ""}.`,
        );
        setJustFinished(true);
      } else {
        const res = await fetch(`${apiUrl}/p2p/drip`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scenario: a.run.scenario }),
        });
        const d = (await res.json()) as { supplier?: string; invoiceNumber?: string; error?: string };
        setMsg(res.ok ? `${d.supplier} ${d.invoiceNumber} landed in the capture queue — watch the live flow.` : (d.error ?? "failed"));
        if (res.ok) setJustFinished(true);
      }
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    await load();
  };

  const busy = p?.job.running ?? false;
  const scenario = SCENARIOS.find((s) => s.id === sel)!;
  const totalDataset = p ? p.months.reduce((s, m) => s + m.dataset.total, 0) : 0;
  const totalLoaded = p ? p.months.reduce((s, m) => s + m.loaded.total, 0) : 0;

  return (
    <main className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Test panel</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Test scenarios, kept separate from the finance product. Each states what it does, what
            data it uses, and what it does and does not demonstrate.
          </p>
        </div>
      </section>

      {/* current state strip */}
      {p && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { v: `${totalLoaded}/${totalDataset}`, l: "transactions in the books" },
            { v: p.nextMonth ? monthLabel(p.nextMonth) : "all loaded ✓", l: "next unloaded month" },
            { v: Number(p.integrity.balance) === 0 ? "✓ 0" : p.integrity.balance, l: "GL balance" },
            { v: p.split.ap_exceptions, l: "exceptions open" },
            { v: `$${(p.modelSpend.costCents / 100).toFixed(2)}`, l: "model spend today" },
          ].map((s) => (
            <div key={s.l} className="rounded-xl border p-3 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="text-lg font-semibold tracking-tight">{s.v}</div>
              <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{s.l}</div>
            </div>
          ))}
        </section>
      )}

      {/* what test data exists — before anything runs */}
      {ds && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <button onClick={() => setShowData(!showData)} className="flex w-full items-baseline justify-between text-left">
            <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Test data available
            </span>
            <span className="text-xs" style={{ color: "var(--accent)" }}>{showData ? "hide" : "show detail"}</span>
          </button>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {ds.months.length} months ({monthLabel(ds.months[0]!.month)} – {monthLabel(ds.months[ds.months.length - 1]!.month)}) ·{" "}
            {ds.ap.chains} supplier invoice chains (each a requisition+PO{ds.ap.goodsReceipts ? `, ${ds.ap.goodsReceipts} with goods receipts` : ""}) ·{" "}
            {ds.ar.invoices} customer invoices ({ds.ar.contracts} with contracts) · {ds.bank.lines} bank lines ·{" "}
            {Object.values(ds.ap.plantedExceptions).reduce((a, b) => a + b, 0)} planted exceptions ·{" "}
            {ds.masters.suppliers} suppliers, {ds.masters.customers} customers. Generated once by the Transaction
            Generator Agent and committed to the repository; every run uses the same dataset.
          </p>
          {showData && (
            <div className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Invoice formats</div>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(ds.ap.formats).map(([k, v]) => (
                    <li key={k} className="tabular-nums">{v} × {k === "text_pdf" ? "text-layer PDF" : k === "ubl_xml" ? "UBL e-invoice (parsed, no model)" : "scanned image (vision)"}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Planted exceptions</div>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(ds.ap.plantedExceptions).map(([k, v]) => (
                    <li key={k} className="tabular-nums">{v} × {k.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Bank feed</div>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(ds.bank.kinds).map(([k, v]) => (
                    <li key={k} className="tabular-nums">{v} × {k.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}

      {/* live run banner */}
      {p && busy && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="font-medium">Running — {p.job.mode}</span>
            <span className="tabular-nums">{p.job.done}/{p.job.total || "…"} items</span>
            <span className="tabular-nums">{mmss(p.job.elapsedMs)} elapsed</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>{p.job.message}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div className="h-full rounded-full transition-all" style={{ background: "var(--accent)", width: p.job.total ? `${(p.job.done / p.job.total) * 100}%` : "10%" }} />
          </div>
        </section>
      )}
      {msg && <p className="text-sm" style={{ color: "var(--muted)" }}>{msg}</p>}
      {p?.job.error && !busy && <p className="text-sm" style={{ color: "var(--bad)" }}>Last run failed: {p.job.error.slice(0, 140)}</p>}

      {/* catalog + detail + live board */}
      <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,5fr)_minmax(0,4fr)]">
        <div className="space-y-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSel(s.id); setConfirm(null); setMsg(null); setJustFinished(false); }}
              className="block w-full rounded-xl border p-3 text-left"
              style={{
                borderColor: sel === s.id ? "var(--accent)" : "var(--border)",
                background: "var(--card)",
              }}
            >
              <div className="text-sm font-medium">{s.title}</div>
              <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{s.tagline}</div>
            </button>
          ))}
        </div>

        <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <h3 className="text-lg font-semibold">{scenario.title}</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{scenario.tagline}</p>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
            <span>Cost: <span style={{ color: "var(--foreground)" }}>{scenario.cost}</span></span>
            <span>Takes: <span style={{ color: "var(--foreground)" }}>{scenario.duration}</span></span>
          </div>

          <p className="mt-4 text-sm leading-6">{scenario.does}</p>
          <p className="mt-2 text-sm leading-6"><span className="font-medium">Data:</span> {scenario.uses}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--good)" }}>What it proves</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {scenario.proves.map((x, i) => <li key={i}>· {x}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--warn)" }}>What it does not prove</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {scenario.notProves.map((x, i) => <li key={i}>· {x}</li>)}
                {scenario.notProves.length === 0 && <li style={{ color: "var(--muted)" }}>—</li>}
              </ul>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            {scenario.actions.map((a) =>
              confirm === a.label ? (
                <span key={a.label} className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: "var(--bad)" }}>
                    {a.run.kind === "reset" && (a.run.mode === "zero" ? "Wipes ALL transactions." : a.run.mode === "cold-all" ? "Wipes, then ~300 real model extractions (~£3–4, 20–30 min)." : "Wipes and re-runs ALL transactions.")} Sure?
                  </span>
                  <button onClick={() => fire(a)} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: "var(--bad)" }}>
                    Yes, go
                  </button>
                  <button onClick={() => setConfirm(null)} className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)" }}>
                    Cancel
                  </button>
                </span>
              ) : (
                <Button
                  key={a.label}
                  disabled={busy || (a.needsNextMonth && !p?.nextMonth)}
                  onClick={() => (a.danger ? setConfirm(a.label) : fire(a))}
                  variant={a.danger ? "danger" : "outline"}
                >
                  {a.needsNextMonth && p?.nextMonth ? a.label.replace("next month", monthLabel(p.nextMonth)) : a.label}
                  {a.wipes !== undefined && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                      {a.wipes ? "wipes first" : "adds to books"}
                    </span>
                  )}
                </Button>
              ),
            )}
          </div>

          {/* post-run guidance — live counters */}
          <div
            className="mt-4 rounded-lg border p-3"
            style={{ borderColor: justFinished ? "var(--accent)" : "var(--border)", background: "var(--background)" }}
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: justFinished ? "var(--accent)" : "var(--muted)" }}>
              {justFinished ? "Run complete — suggested next steps" : "After it runs — next steps"}
            </h4>
            <ul className="mt-2 space-y-1.5 text-sm">
              {scenario.next.map((n, i) => {
                const count =
                  n.count === "exceptions" ? p?.split.ap_exceptions : n.count === "approvals" ? p?.split.awaiting_human : n.count === "queue" ? p?.split.agent_queue : null;
                return (
                  <li key={i}>
                    <Link href={n.href} className="hover:underline" style={{ color: "var(--accent)" }}>
                      {n.label}
                      {count !== null && count !== undefined && (
                        <span className="ml-1.5 rounded-full border px-1.5 text-xs tabular-nums" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                          {count}
                        </span>
                      )}
                      {" →"}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* the live board, alongside the scenario being run */}
        <div className="space-y-3">
          {p ? (
            <>
              <BoardLanes p={p} />
              <BoardTicker p={p} />
            </>
          ) : (
            <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--muted)" }}>
              Loading the board…
            </div>
          )}
        </div>
      </section>

      {p && <BoardTiles p={p} />}
      {p && <BoardRuns p={p} />}
    </main>
  );
}
