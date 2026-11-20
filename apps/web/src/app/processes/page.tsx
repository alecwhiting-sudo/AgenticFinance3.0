"use client";

/** Cross-process dashboard (MASTER_PLAN Phase 6): the finance function at a
 * glance — one lane per process family showing where work sits in the pipe,
 * what is stuck and what waits on a human, with a controls strip on top.
 * Honesty rules as the home page: every figure is derived, book-filtered,
 * and links to the queue it counts. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { moneyCompact } from "@/lib/format";
import { Card } from "@/components/ui";

type Flow = { n: number; totalMinor: number };
type Processes = {
  p2p: {
    posAwaitingApproval: number;
    posOpen: number;
    invoices: Record<"captured" | "matched" | "exception" | "approved" | "posted" | "scheduled" | "paid", Flow>;
    fraudHolds: Flow;
    apOverdueMinor: number;
    paymentsProposed: Flow;
    paidThisMonth: Flow;
  };
  o2c: {
    arOpen: Flow;
    arOverdue: Flow;
    receiptsUnapplied: Flow;
    receiptsThisMonthMinor: number;
    receiptQueries: number;
    disputes: number;
    dunningThisMonth: number;
  };
  r2r: {
    period: string | null;
    journals: number;
    resultMinor: number | null;
    periodTicked: boolean;
    failedEvents: number;
    bankRec: { matched: number; total: number };
    boardPack: { id: string; status: string; label: string } | null;
  };
  controls: {
    approvalsPending: number;
    mailDrafts: number;
    straightThroughPct: number | null;
    agentsGreen: number;
    agentsGraded: number;
    agentsActive: number;
  };
};

const monthName = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** One line in a lane: count (mono) + label, money on the right, the whole
 * row linking to the queue it counts. tone colours the count by meaning. */
function Row({
  label,
  n,
  money,
  href,
  tone,
  hint,
}: {
  label: string;
  n: number | string;
  money?: number;
  href: string;
  tone?: "warn" | "bad" | "ok";
  hint?: string;
}) {
  const color = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : tone === "ok" ? "var(--good)" : undefined;
  return (
    <Link
      href={href}
      className="-mx-2 flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums" style={color ? { color } : undefined}>
          {n}
        </span>
        <span className="truncate">
          {label}
          {hint && (
            <span className="ml-1.5 text-xs" style={{ color: "var(--muted)" }}>
              {hint}
            </span>
          )}
        </span>
      </span>
      {money != null && (
        <span className="shrink-0 font-mono text-xs tabular-nums" style={{ color: "var(--muted)" }}>
          {moneyCompact(money)}
        </span>
      )}
    </Link>
  );
}

/** The AP invoice funnel: proportional bars so the shape of the pipe reads
 * at a glance — where volume sits, where it is stuck. */
function Funnel({ inv }: { inv: Processes["p2p"]["invoices"] }) {
  const stages: { key: keyof Processes["p2p"]["invoices"]; label: string; href: string; tone?: "warn" }[] = [
    { key: "captured", label: "captured", href: "/p2p/invoices?status=captured" },
    { key: "matched", label: "matched", href: "/p2p/invoices?status=matched" },
    { key: "exception", label: "exception", href: "/p2p/exceptions", tone: "warn" },
    { key: "approved", label: "approved", href: "/p2p/invoices?status=approved" },
    { key: "posted", label: "posted", href: "/p2p/invoices?status=posted" },
    { key: "scheduled", label: "scheduled", href: "/p2p/payments" },
    { key: "paid", label: "paid", href: "/p2p/payments" },
  ];
  const max = Math.max(1, ...stages.map((s) => inv[s.key].n));
  return (
    <div className="space-y-1">
      {stages.map((s) => {
        const f = inv[s.key];
        return (
          <Link key={s.key} href={s.href} className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5">
            <span className="w-16 shrink-0 text-xs" style={{ color: "var(--muted)" }}>
              {s.label}
            </span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(f.n > 0 ? 3 : 0, (f.n / max) * 100)}%`,
                  background: s.tone === "warn" ? "var(--warn)" : "var(--accent)",
                  opacity: s.tone === "warn" ? 1 : 0.75,
                }}
              />
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums">{f.n}</span>
          </Link>
        );
      })}
    </div>
  );
}

function Lane({
  title,
  href,
  attention,
  children,
}: {
  title: string;
  href: string;
  attention: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide">{title}</h3>
        <span className="flex items-center gap-2">
          {attention > 0 && (
            <span
              className="whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium"
              style={{ background: "color-mix(in srgb, var(--warn) 15%, transparent)", color: "var(--warn)" }}
            >
              {attention} need{attention === 1 ? "s" : ""} a human
            </span>
          )}
          <Link href={href} className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
            open →
          </Link>
        </span>
      </div>
      {children}
    </Card>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="mt-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
      {label}
    </div>
  );
}

export default function ProcessesPage() {
  const [d, setD] = useState<Processes | null>(null);
  const [down, setDown] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/dashboard/processes`);
      if (res.ok) setD((await res.json()) as Processes);
      setDown(false);
    } catch {
      setDown(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (down && !d)
    return (
      <main>
        <h2 className="text-2xl font-semibold tracking-tight">Processes</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Cannot reach the API at {apiUrl}.
        </p>
      </main>
    );

  const c = d?.controls;
  const recPct = d && d.r2r.bankRec.total > 0 ? Math.round((d.r2r.bankRec.matched / d.r2r.bankRec.total) * 100) : null;
  const p2pAttention = d ? d.p2p.invoices.exception.n + d.p2p.posAwaitingApproval + d.p2p.paymentsProposed.n : 0;
  const o2cAttention = d ? d.o2c.receiptQueries + d.o2c.disputes : 0;
  const r2rAttention = d ? d.r2r.failedEvents + (d.r2r.boardPack && d.r2r.boardPack.status === "draft" ? 1 : 0) : 0;

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Processes</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          The finance function at a glance — where work sits in each pipe, what is stuck, and what waits on a
          human. Every row links to its queue.
        </p>
      </section>

      {/* controls strip: everything a human owes the machine, plus assurance */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          {
            v: String(c?.approvalsPending ?? 0),
            l: "approvals pending",
            hint: "commands agents proposed",
            href: "/approvals",
            warn: (c?.approvalsPending ?? 0) > 0,
          },
          {
            v: String(c?.mailDrafts ?? 0),
            l: "mail drafts to release",
            hint: "external comms wait for you",
            href: "/p2p/mail",
            warn: (c?.mailDrafts ?? 0) > 0,
          },
          {
            v: String(d?.p2p.fraudHolds.n ?? 0),
            l: "fraud-risk holds",
            hint: d ? `${moneyCompact(d.p2p.fraudHolds.totalMinor)} held — verbal verification only` : undefined,
            href: "/p2p/exceptions",
            bad: (d?.p2p.fraudHolds.n ?? 0) > 0,
          },
          {
            v: c?.straightThroughPct != null ? `${c.straightThroughPct}%` : "—",
            l: "straight-through rate",
            hint: "invoices needing zero touches",
            href: "/p2p",
          },
          {
            v: c ? `${c.agentsGreen}/${c.agentsGraded}` : "—",
            l: "agent suites green",
            hint: c && c.agentsActive > c.agentsGraded ? `${c.agentsActive - c.agentsGraded} never graded` : "latest eval per agent",
            href: "/agents",
            warn: c != null && c.agentsGreen < c.agentsGraded,
          },
        ].map((s) => (
          <Link
            key={s.l}
            href={s.href}
            className="block rounded-xl border p-3 text-center transition-colors hover:border-[var(--accent)]"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <div
              className="text-xl font-semibold tracking-tight"
              style={s.bad ? { color: "var(--bad)" } : s.warn ? { color: "var(--warn)" } : undefined}
            >
              {s.v}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {s.l}
            </div>
            {s.hint && (
              <div className="text-[10px]" style={{ color: "var(--muted)" }}>
                {s.hint}
              </div>
            )}
          </Link>
        ))}
      </section>

      {/* the three lanes */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Lane title="P2P — Purchase to Pay" href="/p2p" attention={p2pAttention}>
          <Divider label="Buying" />
          <div>
            <Row n={d?.p2p.posAwaitingApproval ?? 0} label="purchases awaiting approval" href="/p2p/purchases" tone={d && d.p2p.posAwaitingApproval > 0 ? "warn" : undefined} />
            <Row n={d?.p2p.posOpen ?? 0} label="POs awaiting goods" href="/p2p/purchases" />
          </div>
          <Divider label="Invoice pipe (open + settled)" />
          {d && <Funnel inv={d.p2p.invoices} />}
          {d && d.p2p.fraudHolds.n > 0 && (
            <Row
              n={d.p2p.fraudHolds.n}
              label="of these are fraud-risk holds"
              money={d.p2p.fraudHolds.totalMinor}
              href="/p2p/exceptions"
              tone="bad"
            />
          )}
          <Divider label="Paying" />
          <div>
            <Row
              n={d?.p2p.paymentsProposed.n ?? 0}
              label="payment runs awaiting approval"
              money={d?.p2p.paymentsProposed.totalMinor}
              href="/p2p/payments"
              tone={d && d.p2p.paymentsProposed.n > 0 ? "warn" : undefined}
            />
            <Row n={d?.p2p.paidThisMonth.n ?? 0} label="runs paid this month" money={d?.p2p.paidThisMonth.totalMinor} href="/p2p/payments" />
            <Row n="£" label="AP overdue" money={d?.p2p.apOverdueMinor} href="/p2p/invoices" tone={d && d.p2p.apOverdueMinor > 0 ? "bad" : undefined} />
          </div>
        </Lane>

        <Lane title="O2C — Order to Cash" href="/o2c" attention={o2cAttention}>
          <Divider label="Receivables" />
          <div>
            <Row n={d?.o2c.arOpen.n ?? 0} label="invoices open" money={d?.o2c.arOpen.totalMinor} href="/o2c/invoices" />
            <Row
              n={d?.o2c.arOverdue.n ?? 0}
              label="overdue"
              money={d?.o2c.arOverdue.totalMinor}
              href="/o2c"
              tone={d && d.o2c.arOverdue.n > 0 ? "bad" : undefined}
            />
            <Row n={d?.o2c.dunningThisMonth ?? 0} label="chase letters sent this month" href="/o2c" />
          </div>
          <Divider label="Cash application" />
          <div>
            <Row
              n={d?.o2c.receiptsUnapplied.n ?? 0}
              label="receipts unapplied"
              money={d?.o2c.receiptsUnapplied.totalMinor}
              href="/o2c"
              tone={d && d.o2c.receiptsUnapplied.n > 0 ? "warn" : undefined}
            />
            <Row n="£" label="cash applied this month" money={d?.o2c.receiptsThisMonthMinor} href="/o2c" tone="ok" />
          </div>
          <Divider label="Cases" />
          <div>
            <Row n={d?.o2c.receiptQueries ?? 0} label="receipt queries open" href="/o2c" tone={d && d.o2c.receiptQueries > 0 ? "warn" : undefined} />
            <Row
              n={d?.o2c.disputes ?? 0}
              label="disputes open"
              hint="dunning held while open"
              href="/o2c"
              tone={d && d.o2c.disputes > 0 ? "warn" : undefined}
            />
          </div>
        </Lane>

        <Lane title="R2R — Record to Report" href="/r2r" attention={r2rAttention}>
          <Divider label={d?.r2r.period ? `Latest complete month — ${monthName(d.r2r.period)}` : "Latest complete month"} />
          <div>
            <Row
              n="£"
              label={`result${d?.r2r.resultMinor != null && d.r2r.resultMinor < 0 ? " (loss)" : ""}`}
              money={d?.r2r.resultMinor ?? undefined}
              href="/reports"
            />
            <Row n={d?.r2r.journals ?? 0} label="journals posted" href="/journals" />
            <Row
              n={d?.r2r.periodTicked ? "✓" : "—"}
              label="month-end tick processed"
              hint="accruals & prepayments"
              href="/r2r"
              tone={d?.r2r.periodTicked ? "ok" : "warn"}
            />
          </div>
          <Divider label="Assurance" />
          <div>
            <Row
              n={recPct != null ? `${recPct}%` : "—"}
              label="bank lines reconciled"
              hint={d ? `${d.r2r.bankRec.matched} of ${d.r2r.bankRec.total}` : undefined}
              href="/r2r"
              tone={recPct != null && recPct < 100 ? "warn" : "ok"}
            />
            <Row
              n={d?.r2r.failedEvents ?? 0}
              label="failed platform events"
              href="/r2r"
              tone={d && d.r2r.failedEvents > 0 ? "bad" : "ok"}
            />
            <Row
              n={d?.r2r.boardPack ? (d.r2r.boardPack.status === "draft" ? "✓" : "…") : "—"}
              label={
                d?.r2r.boardPack
                  ? `board pack ${d.r2r.boardPack.status === "draft" ? "drafted" : d.r2r.boardPack.status} — ${d.r2r.boardPack.label}`
                  : "no board pack for the month yet"
              }
              href="/reports/board"
              tone={d?.r2r.boardPack?.status === "draft" ? "ok" : undefined}
            />
          </div>
        </Lane>
      </section>
    </main>
  );
}
