"use client";

/** Home dashboard v2 (plans/DATASET_V2.md PR-F): live motion over static
 * totals. Every tile either MOVES when the business moves or answers a
 * question a CFO actually asks — money KPIs with a cash sparkline, a
 * what-happened-today motion row, the live run strip whenever the pipeline
 * is working, and an agent roster that shows who is working RIGHT NOW.
 * Master-data counts moved to Admin. Honesty rules hold: every figure
 * drills to its page, "to date" labels the in-progress month. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { moneyCompact } from "@/lib/format";
import { Card, SectionTitle } from "@/components/ui";
import LiveFeed from "@/components/LiveFeed";
import { mmss, type Pipeline } from "@/components/MissionBoard";

type Kpis = {
  cash: { nowMinor: number; series: { date: string; balanceMinor: number }[] };
  result: {
    period: string | null;
    thisMinor: number | null;
    priorMinor: number | null;
    toDatePeriod: string | null;
    toDateMinor: number | null;
  };
  ar: { openMinor: number; overdueMinor: number };
  ap: { openMinor: number; overdueMinor: number; due7Minor: number };
  motion: { invoicesToday: number; exceptionsOpen: number; casesRaisedToday: number; straightThroughPct: number | null };
  agents: { slug: string; name: string; working: number; queued: number; runs_today: number; last_summary: string | null; last_at: string | null }[];
};
type Overview = { company: { name: string; code: string; currency: string }; currentPeriod: { code: string; status: string } | null };

const monthName = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

/** Tiny inline sparkline — muted line, accent closing dot (§4.7). */
function Spark({ series }: { series: { balanceMinor: number }[] }) {
  if (series.length < 2) return null;
  const W = 96;
  const H = 28;
  const vals = series.map((s) => s.balanceMinor);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = (i: number) => (i / (vals.length - 1)) * (W - 4) + 2;
  const y = (v: number) => 2 + (1 - (v - min) / (max - min || 1)) * (H - 6);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--muted)" strokeWidth="1.25" opacity="0.7" />
      <circle cx={x(vals.length - 1)} cy={y(vals.at(-1)!)} r="2.5" fill="var(--accent)" />
    </svg>
  );
}

function MoneyTile({
  label,
  value,
  hint,
  href,
  spark,
}: {
  label: string;
  value: string;
  hint?: string;
  href: string;
  spark?: React.ReactNode;
}) {
  return (
    <Link href={href} className="block rounded-xl border p-4 transition-colors hover:border-[var(--accent)]" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        </div>
        {spark}
      </div>
      {hint && <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{hint}</div>}
    </Link>
  );
}

export default function Dashboard() {
  const [k, setK] = useState<Kpis | null>(null);
  const [p, setP] = useState<Pipeline | null>(null);
  const [o, setO] = useState<Overview | null>(null);
  const [down, setDown] = useState(false);

  const load = useCallback(async () => {
    try {
      const [kr, pr] = await Promise.all([fetch(`${apiUrl}/dashboard/kpis`), fetch(`${apiUrl}/admin/pipeline`)]);
      if (kr.ok) setK((await kr.json()) as Kpis);
      if (pr.ok) setP((await pr.json()) as Pipeline);
      setDown(false);
    } catch {
      setDown(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void fetch(`${apiUrl}/company/overview`).then((r) => r.json()).then((d) => setO(d as Overview)).catch(() => {});
  }, [load]);
  // tick faster while the pipeline is actually doing something
  const running = p?.job.running ?? false;
  useEffect(() => {
    const t = setInterval(load, running ? 2000 : 8000);
    return () => clearInterval(t);
  }, [load, running]);

  if (down && !k)
    return (
      <main>
        <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Cannot reach the API at {apiUrl}.</p>
      </main>
    );

  const straight = k?.motion.straightThroughPct;

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">{o?.company.name ?? "Brightline Ltd"}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {o ? `${o.company.code} · ${o.company.currency} · period ${o.currentPeriod?.code ?? "—"} (${o.currentPeriod?.status ?? "none"})` : "…"}
          {" · master data lives in "}
          <Link href="/admin" className="hover:underline" style={{ color: "var(--accent)" }}>Admin</Link>
        </p>
      </section>

      {/* live run strip: the pipeline working is visible from the front door */}
      {p && running && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="font-medium">Pipeline running — {p.job.mode}</span>
            <span className="tabular-nums">{p.job.done}/{p.job.total || "…"} items</span>
            <span className="tabular-nums">{mmss(p.job.elapsedMs)}</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>{p.job.message}</span>
            <Link href="/test" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>mission control →</Link>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div className="h-full rounded-full transition-all" style={{ background: "var(--accent)", width: p.job.total ? `${(p.job.done / p.job.total) * 100}%` : "10%" }} />
          </div>
        </section>
      )}

      {/* money row — what a CFO asks first */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MoneyTile
          label="Cash"
          value={moneyCompact(k?.cash.nowMinor ?? 0)}
          hint="latest bank statement line"
          href="/analytics"
          spark={k ? <Spark series={k.cash.series} /> : undefined}
        />
        <MoneyTile
          label={k?.result.period ? `${monthName(k.result.period)} result` : "Result"}
          value={k?.result.thisMinor != null ? moneyCompact(k.result.thisMinor) : "—"}
          hint={
            k?.result.toDatePeriod
              ? `${monthName(k.result.toDatePeriod)} to date: ${moneyCompact(k.result.toDateMinor ?? 0)}`
              : k?.result.priorMinor != null
                ? `prior month ${moneyCompact(k.result.priorMinor)}`
                : undefined
          }
          href="/reports"
        />
        <MoneyTile
          label="AR overdue"
          value={moneyCompact(k?.ar.overdueMinor ?? 0)}
          hint={`of ${moneyCompact(k?.ar.openMinor ?? 0)} open`}
          href="/o2c"
        />
        <MoneyTile
          label="AP due in 7 days"
          value={moneyCompact(k?.ap.due7Minor ?? 0)}
          hint={`${moneyCompact(k?.ap.overdueMinor ?? 0)} already overdue of ${moneyCompact(k?.ap.openMinor ?? 0)} open`}
          href="/p2p/invoices"
        />
      </section>

      {/* motion row — what is happening */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { v: String(k?.motion.invoicesToday ?? 0), l: "invoices processed today", hint: "captured through intake", href: "/p2p/invoices" },
          { v: straight != null ? `${straight}%` : "—", l: "straight-through rate", hint: "posted with zero touches since approval", href: "/p2p" },
          { v: String(k?.motion.exceptionsOpen ?? 0), l: "exceptions open", hint: `${k?.motion.casesRaisedToday ?? 0} cases raised today`, href: "/p2p/exceptions" },
          { v: p ? `$${(p.modelSpend.costCents / 100).toFixed(2)}` : "—", l: "model spend today", hint: p ? `${p.modelSpend.runs} runs · ${(p.modelSpend.tokens / 1000).toFixed(0)}k tokens` : undefined, href: "/test" },
        ].map((s) => (
          <Link key={s.l} href={s.href} className="block rounded-xl border p-3 text-center transition-colors hover:border-[var(--accent)]" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <div className="text-xl font-semibold tracking-tight">{s.v}</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{s.l}</div>
            {s.hint && <div className="text-[10px]" style={{ color: "var(--muted)" }}>{s.hint}</div>}
          </Link>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <Card className="md:col-span-3">
          <SectionTitle>Live activity</SectionTitle>
          <LiveFeed />
        </Card>
        <Card className="md:col-span-2">
          <SectionTitle>Agents — who is working now</SectionTitle>
          <ul className="space-y-2.5">
            {(k?.agents ?? []).map((a) => (
              <li key={a.slug}>
                <Link href={`/agents/${a.slug}`} className="-m-2 block rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    {a.working > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium" style={{ color: "var(--accent)" }}>
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--accent)", animation: "breathe 1.6s ease-in-out infinite" }} />
                        working now
                      </span>
                    ) : a.queued > 0 ? (
                      <span className="shrink-0 text-[10px]" style={{ color: "var(--warn)" }}>{a.queued} queued</span>
                    ) : (
                      <span className="shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>idle</span>
                    )}
                  </div>
                  <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
                    {a.runs_today > 0 ? `${a.runs_today} run${a.runs_today === 1 ? "" : "s"} today` : "no runs today"}
                    {a.last_summary ? ` · ${a.last_at} ${a.last_summary}` : ""}
                  </div>
                </Link>
              </li>
            ))}
            {(k?.agents ?? []).length === 0 && <li className="text-sm" style={{ color: "var(--muted)" }}>No agents registered.</li>}
          </ul>
        </Card>
      </section>
    </main>
  );
}
