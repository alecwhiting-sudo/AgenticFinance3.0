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

type Pipeline = {
  months: { month: string; dataset: { total: number }; loaded: { total: number } }[];
  split: { ap_exceptions: number; agent_queue: number; awaiting_human: number };
  integrity: { journals: number; events: number; balance: string };
  nextMonth: string | null;
  modelSpend: { runs: number; tokens: number; costCents: number };
  job: { running: boolean; mode: string; done: number; total: number; message: string; error: string | null; elapsedMs: number };
};

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
  /** the anticlimax fix: after the run, this is where the show continues */
  next: NextStep[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "months",
    title: "Run the year, month by month",
    tagline: "The CFO's year on fast-forward — stop between months and look around.",
    cost: "£0 — no model calls (deterministic processing)",
    duration: "~2s per month instant · pauses at each close in auto mode",
    does:
      "Processes one month's transactions through the full pipeline — purchases, receipts, supplier invoices matched and posted, customer billing, bank feed — then stops. Between months you inspect: run month-end, read the P&L, check the exceptions queue, draft the close commentary. 'Run remaining months' advances automatically with a pause at each boundary.",
    uses: "The committed Brightline dataset, in date order: ~120 transactions a month across AP, AR and bank, with planted exceptions.",
    proves: [
      "The close discipline: month-end accruals post and reverse through the same pipe as everything else",
      "Books balance at every stopping point — GL to zero, journals = events",
      "Exceptions accumulate realistically and wait for judgement",
      "Statements and commentary reflect exactly what has been processed so far",
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
      { label: "The statements now reflect exactly what's processed", href: "/reports" },
      { label: "Exceptions waiting for judgement — open the workbench", href: "/p2p/exceptions", count: "exceptions" },
      { label: "Approvals waiting for you", href: "/approvals", count: "approvals" },
    ],
  },
  {
    id: "tenx",
    title: "The 10x stress test",
    tagline: "What if your volume were ten times this? Same machine, same morning.",
    cost: "£0 — no model calls",
    duration: "baseline ~2s · full run ~15–60s, timed live",
    does:
      "Two runs, side by side. First process one normal month and note the numbers. Then wipe and run the ENTIRE dataset — ten months' volume treated as one month's workload — flat out with the timer on. The runs table on mission control shows both: items, minutes, throughput, and the number that matters — human touches barely move, because exceptions scale with the exception rate, not the volume.",
    uses: "The full dataset as one batch: 300 supplier invoice chains, 400 customer invoices, 508 bank lines, 36 planted exceptions (~12%).",
    proves: [
      "Machine time scales linearly and costs nothing — deterministic code, zero tokens",
      "Human workload scales only with genuine exceptions (36 out of ~1,200)",
      "Integrity under load: balanced books and journal=event parity at full speed",
    ],
    notProves: [
      "Document extraction (structured data, not reading PDFs — see 'From scratch')",
      "Absolute speed — demo infrastructure; the honest claim is the shape, not the number",
    ],
    actions: [
      { label: "1 · Baseline month", run: { kind: "reset", mode: "month", paceMs: 0 }, needsNextMonth: true, wipes: false },
      { label: "2 · Run 10x — full speed", run: { kind: "reset", mode: "replay", paceMs: 0 }, danger: true, wipes: true },
    ],
    next: [
      { label: "The side-by-side: baseline vs 10x in the runs table", href: "/admin/pipeline" },
      { label: "The human workload that didn't scale — the exceptions workbench", href: "/p2p/exceptions", count: "exceptions" },
      { label: "Approvals waiting — still a human-sized queue", href: "/approvals", count: "approvals" },
      { label: "Books balanced the whole way — drill any number", href: "/reports" },
    ],
  },
  {
    id: "cold",
    title: "From scratch — agents read every document",
    tagline: "The inbox is full of unread invoices. Watch the agents actually read them.",
    cost: "~50–70p per month · ~£3–4 for everything (Haiku-tier extraction, metered live)",
    duration: "~3–5 min per month · ~20–30 min for everything",
    does:
      "Internal records (purchases, goods receipts, customer billing, bank feed) load as system data — they're yours already. But supplier invoices arrive as unread documents: the Invoice Extraction Agent reads each one for real — text PDFs and e-invoices from their content, scanned images by vision — proposes the capture, and the pipeline matches, posts or raises the exception. Suppliers graduate to learned templates as it goes. Payments wait for you on the payments page afterwards.",
    uses: "The same dataset, but AP invoices as documents in the capture queue; the 'model spend today' tile meters the real cost.",
    proves: [
      "Genuine model extraction, including vision on scans with no text layer",
      "The control chain: agent proposes → gateway validates → deterministic match decides",
      "Learned templates (D15): repeat suppliers go free; the extraction bill falls as it runs",
      "Exact cost per document, measured not estimated",
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
      { label: "Watch the agents read the queue down", href: "/work", count: "queue" },
      { label: "Learned templates building on the P2P page — repeat suppliers go free", href: "/p2p" },
      { label: "Exceptions the extraction surfaced — resolve them in the workbench", href: "/p2p/exceptions", count: "exceptions" },
      { label: "Then release the payments yourself", href: "/p2p/payments" },
      { label: "What it actually cost — model spend tile", href: "/admin/pipeline" },
    ],
  },
  {
    id: "replay",
    title: "Replay the full history",
    tagline: "Cutover day: ten months of history into a new system of record.",
    cost: "£0 — no model calls",
    duration: "~30s–5min depending on pace",
    does:
      "Wipes the books, then replays the complete ten-month history in date order — dates respected, every month landing as it originally happened — with the live feed narrating. Run it twice and the books come out identical: that's the audit guarantee, not a demo trick.",
    uses: "The full dataset in chronological order, payments and receipts included (history contains its own settlements).",
    proves: [
      "Replay determinism (D13): same events, same books, every time",
      "A realistic enterprise moment — migration/cutover onto the platform",
      "All controls live under continuous load: immutability, balance enforcement, idempotency",
    ],
    notProves: ["Document extraction (structured data)", "Anything about day-to-day operations pacing — it's history at demo speed"],
    actions: [{ label: "Replay everything — paced", run: { kind: "reset", mode: "replay", paceMs: 120 }, danger: true, wipes: true }],
    next: [
      { label: "Drill any statement number to its source event", href: "/reports" },
      { label: "Trial balance — journals = events, GL to zero", href: "/ledger" },
      { label: "Run it again from the board: identical books, every time", href: "/admin/pipeline" },
    ],
  },
  {
    id: "day",
    title: "Simulate a day",
    tagline: "It's 9am. Here's what arrived overnight.",
    cost: "~2–4p (a few Haiku-tier extractions)",
    duration: "~1 minute of agent work",
    does:
      "Drips a believable morning into the live system: a clean e-invoice that goes straight through, a scanned PDF the agent must read by vision, one exception (random — price variance, short receipt, missing receipt, unknown supplier or a bank-detail-change email), and a customer receipt investigation when one is available. Watch on the live flow, finish in the approvals inbox.",
    uses: "Fresh synthetic items against the loaded books — needs data loaded first.",
    proves: [
      "The daily experience end to end: arrive → extract → match → exception → human approval",
      "Fraud screening: the bank-detail-change email is flagged, never actioned",
      "Your whole involvement in a day is a couple of clicks",
    ],
    notProves: ["Volume (that's the 10x run)", "The close (that's month by month)"],
    actions: [
      { label: "Simulate a day — everything", run: { kind: "day", scope: "all" }, wipes: false },
      { label: "Just P2P", run: { kind: "day", scope: "p2p" }, wipes: false },
      { label: "Just O2C", run: { kind: "day", scope: "o2c" }, wipes: false },
    ],
    next: [
      { label: "Watch the invoices travel on the live flow", href: "/p2p/flow" },
      { label: "Agents working now", href: "/work", count: "queue" },
      { label: "The exception's case — explore and resolve it in the workbench", href: "/p2p/exceptions", count: "exceptions" },
      { label: "Approve or reject what reached your inbox (incl. the dunning letter)", href: "/approvals", count: "approvals" },
    ],
  },
  {
    id: "drip",
    title: "Single transactions",
    tagline: "Drop one specific scenario in and follow it.",
    cost: "~1–1.5p each",
    duration: "seconds",
    does:
      "Lands one invoice of a chosen shape in the capture queue, exactly as inbound mail would. Useful mid-conversation: 'what happens if a supplier short-ships?' — drip it and watch.",
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
    tagline: "Empty books. The blank slate every scenario starts from.",
    cost: "£0",
    duration: "instant",
    does:
      "Wipes all transactions — documents, journals, events, pending approvals and open cases. Master data, agents, their skills, run history and learned templates survive.",
    uses: "Nothing — it removes.",
    proves: ["Nothing — it's the reset lever"],
    notProves: [],
    actions: [{ label: "Clear to zero", run: { kind: "reset", mode: "zero" }, danger: true, wipes: true }],
    next: [{ label: "Pick a scenario above and build the books back up", href: "/test" }],
  },
];

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.split("-")[1]) - 1]} ${ym.split("-")[0]}`;

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
            Demo land, kept apart from the finance product. Pick a scenario, read what it proves —
            and what it doesn&apos;t — then run it.
          </p>
        </div>
        <Link href="/admin/pipeline" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
          Mission control board →
        </Link>
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
            Generator Agent, committed, deterministic — every run sees the same world.
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
            <Link href="/admin/pipeline" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
              watch on the board →
            </Link>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div className="h-full rounded-full transition-all" style={{ background: "var(--accent)", width: p.job.total ? `${(p.job.done / p.job.total) * 100}%` : "10%" }} />
          </div>
        </section>
      )}
      {msg && <p className="text-sm" style={{ color: "var(--muted)" }}>{msg}</p>}
      {p?.job.error && !busy && <p className="text-sm" style={{ color: "var(--bad)" }}>Last run failed: {p.job.error.slice(0, 140)}</p>}

      {/* catalog + detail */}
      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
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

          {/* where the show continues — the counters are live */}
          <div
            className="mt-4 rounded-lg border p-3"
            style={{ borderColor: justFinished ? "var(--accent)" : "var(--border)", background: "var(--background)" }}
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: justFinished ? "var(--accent)" : "var(--muted)" }}>
              {justFinished ? "Done — this is where the show continues" : "After it runs — where to go"}
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
      </section>
    </main>
  );
}
