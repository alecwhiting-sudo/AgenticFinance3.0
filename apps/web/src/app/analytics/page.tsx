import type { Metadata } from "next";
import Link from "next/link";
import { getJson } from "@/lib/api";
import { money, moneyCompact } from "@/lib/format";
import { Kpi, PageHeader } from "@/components/ui";
import { AreaTrend, ChartCard, HBars, TrendChart, Waterfall } from "@/components/charts";

export const metadata: Metadata = { title: "Analytics" };

/** Phase 4c M1 (plans/ANALYTICS.md): the curated views, charted. Everything
 * on this page is derived aggregation the API serves read-only; every figure
 * drills to the rows behind it and every chart has a table view. */

type Flux = {
  period: string;
  prior: string;
  /** true when the period is the in-progress calendar month */
  partial: boolean;
  periods: string[];
  rows: { code: string; name: string; type: string; thisMinor: number; prevMinor: number; deltaMinor: number }[];
};
type Trend = {
  year: number;
  months: string[];
  rows: { code: string; name: string; type: string; period_code: string; amount_minor: number }[];
};
type Aging = {
  side: "ap" | "ar";
  asOf: string;
  buckets: readonly string[];
  totalMinor: number;
  overdueMinor: number;
  parties: { code: string; name: string; buckets: number[]; totalMinor: number; items: number }[];
};
type Counterparty = {
  dim: "supplier" | "customer";
  months: string[];
  parties: { code: string; name: string; totalMinor: number; invoices: number; series: Record<string, number> }[];
};
type Cash = { points: { date: string; dayMinor: number; balanceMinor: number }[] };

/** Ledger sign is debit-positive; profit contribution flips it: an income
 * credit (negative) is a positive contribution, an expense debit a negative
 * one. Used for the waterfall and all "favourable/adverse" colouring. */
const contribution = (ledgerMinor: number) => -ledgerMinor;

const monthName = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const numTd = "py-1 text-right tabular-nums";
const th = "py-1.5 text-left text-[10px] uppercase tracking-wide";
const thR = "py-1.5 text-right text-[10px] uppercase tracking-wide";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const q = period && /^\d{4}-\d{2}$/.test(period) ? `?period=${period}` : "";
  const [flux, trend, apAging, arAging, suppliers, customers, cash] = await Promise.all([
    getJson<Flux>(`/analytics/flux${q}`),
    getJson<Trend>("/analytics/pl-trend"),
    getJson<Aging>("/analytics/aging?side=ap"),
    getJson<Aging>("/analytics/aging?side=ar"),
    getJson<Counterparty>("/analytics/counterparty?dim=supplier"),
    getJson<Counterparty>("/analytics/counterparty?dim=customer"),
    getJson<Cash>("/analytics/cash"),
  ]);

  if (!trend)
    return (
      <main>
        <PageHeader title="Analytics" context="The analytics API is unavailable." />
      </main>
    );

  /* ---- flux waterfall: profit prior → per-account contributions → profit this ---- */
  const fluxItems = (flux?.rows ?? [])
    .map((r) => ({ ...r, contrib: contribution(r.deltaMinor) }))
    .filter((r) => r.contrib !== 0);
  // fixed categorical order = account code; biggest 10 keep their own bar
  const keep = new Set(
    [...fluxItems].sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 10).map((r) => r.code),
  );
  const shown = fluxItems.filter((r) => keep.has(r.code));
  const otherContrib = fluxItems.filter((r) => !keep.has(r.code)).reduce((n, r) => n + r.contrib, 0);
  const profitPrior = (flux?.rows ?? []).reduce((n, r) => n + contribution(r.prevMinor), 0);
  const profitThis = (flux?.rows ?? []).reduce((n, r) => n + contribution(r.thisMinor), 0);

  /* ---- P&L trend: top accounts by magnitude, displayed positive ---- */
  const byAccount = new Map<string, { code: string; name: string; type: string; total: number; values: Map<string, number> }>();
  for (const r of trend.rows) {
    const e = byAccount.get(r.code) ?? { code: r.code, name: r.name, type: r.type, total: 0, values: new Map() };
    const display = r.type === "income" ? -r.amount_minor : r.amount_minor;
    e.total += Math.abs(display);
    e.values.set(r.period_code, display);
    byAccount.set(r.code, e);
  }
  const topAccounts = [...byAccount.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
    .sort((a, b) => a.code.localeCompare(b.code)); // fixed order: account code
  const trendSeries = topAccounts.map((a) => ({
    label: `${a.code} ${a.name}`,
    href: `/ledger/${a.code}`,
    values: trend.months.map((m) => a.values.get(m) ?? null),
  }));

  /* ---- cash: daily balance, month labels ---- */
  const cashPoints = (cash?.points ?? []).map((p) => ({
    label: new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" }),
    value: p.balanceMinor,
  }));
  // de-duplicate consecutive month labels so the axis reads Jan … Feb … Mar
  for (let i = cashPoints.length - 1; i > 0; i--) if (cashPoints[i]!.label === cashPoints[i - 1]!.label) cashPoints[i]!.label = "";
  const cashNow = cash?.points.at(-1)?.balanceMinor ?? 0;
  const monthEnds = (cash?.points ?? []).filter((p, i, a) => i === a.length - 1 || a[i + 1]!.date.slice(0, 7) !== p.date.slice(0, 7));

  const agingCard = (a: Aging | null, title: string, drillHref: string, drillLabel: string) =>
    a && (
      <ChartCard
        title={title}
        question={`Open items at ${a.asOf}: ${money(a.totalMinor)} total, ${money(a.overdueMinor)} past due.`}
        controls={
          <Link href={drillHref} className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
            {drillLabel} →
          </Link>
        }
        table={
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className={th}>{a.side === "ap" ? "Supplier" : "Customer"}</th>
                {a.buckets.map((b) => (
                  <th key={b} className={thR}>{b}</th>
                ))}
                <th className={thR}>Total</th>
              </tr>
            </thead>
            <tbody>
              {a.parties.map((p) => (
                <tr key={p.code} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1">{p.name}</td>
                  {p.buckets.map((v, i) => (
                    <td key={i} className={numTd}>{v === 0 ? "–" : money(v)}</td>
                  ))}
                  <td className={`${numTd} font-medium`}>{money(p.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <HBars
          segmentLabels={[...a.buckets]}
          rows={a.parties.slice(0, 12).map((p) => ({
            label: p.name,
            segments: p.buckets,
            href: drillHref,
            title: `${p.name} · ${p.items} open · ${money(p.totalMinor)}`,
          }))}
        />
        {a.parties.length > 12 && (
          <p className="mt-2 text-[10px]" style={{ color: "var(--muted)" }}>
            Top 12 of {a.parties.length} shown — the table view has all of them.
          </p>
        )}
      </ChartCard>
    );

  const counterpartyCard = (c: Counterparty | null, title: string, question: string, drillHref: string, drillLabel: string) =>
    c && (
      <ChartCard
        title={title}
        question={question}
        controls={
          <Link href={drillHref} className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
            {drillLabel} →
          </Link>
        }
        table={
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className={th}>Name</th>
                <th className={thR}>Invoices</th>
                <th className={thR}>Total gross</th>
              </tr>
            </thead>
            <tbody>
              {c.parties.map((p) => (
                <tr key={p.code} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1">{p.name}</td>
                  <td className={numTd}>{p.invoices}</td>
                  <td className={numTd}>{money(p.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <HBars
          rows={c.parties.slice(0, 12).map((p) => ({
            label: p.name,
            segments: [p.totalMinor],
            href: drillHref,
            title: `${p.name} · ${p.invoices} invoices · ${money(p.totalMinor)}`,
          }))}
        />
      </ChartCard>
    );

  return (
    <main className="space-y-6">
      <PageHeader
        title="Analytics"
        context="Curated read-only views over the ledger and open items — derived aggregation only, never separate measurement. Every chart drills to the postings behind it and has a table view."
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Cash balance" value={moneyCompact(cashNow)} hint="latest bank statement line" href="/payments" />
        <Kpi
          label={flux ? `${monthName(flux.period)} result${flux.partial ? " (to date)" : ""}` : "Result"}
          value={moneyCompact(profitThis)}
          hint={flux ? `prior month ${moneyCompact(profitPrior)}` : undefined}
          href="/reports"
        />
        <Kpi label="AR overdue" value={moneyCompact(arAging?.overdueMinor ?? 0)} hint={`of ${moneyCompact(arAging?.totalMinor ?? 0)} open`} href="/o2c" />
        <Kpi label="AP open" value={moneyCompact(apAging?.totalMinor ?? 0)} hint={`${moneyCompact(apAging?.overdueMinor ?? 0)} past due`} href="/p2p/invoices" />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {flux && (
          <ChartCard
            title={`Month flux — ${monthName(flux.period)}${flux.partial ? " (month to date)" : ""} vs ${monthName(flux.prior)}`}
            question={
              flux.partial
                ? `${monthName(flux.period)} is still in progress — a partial month against a full one reads as everything falling; compare complete months for the real story.`
                : "Why did the result move? Teal bars helped, amber bars hurt; grey anchors are each month's result."
            }
            table={
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                    <th className={th}>Account</th>
                    <th className={thR}>{flux.prior}</th>
                    <th className={thR}>{flux.period}</th>
                    <th className={thR}>Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {fluxItems.map((r) => (
                    <tr key={r.code} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="py-1">
                        <Link href={`/ledger/${r.code}?period=${flux.period}`} className="hover:underline">
                          {r.code} {r.name}
                        </Link>
                      </td>
                      <td className={numTd}>{money(contribution(r.prevMinor))}</td>
                      <td className={numTd}>{money(contribution(r.thisMinor))}</td>
                      <td className={`${numTd} font-medium`} style={{ color: r.contrib >= 0 ? "var(--good)" : "var(--bad)" }}>
                        {money(r.contrib)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[10px]" style={{ color: "var(--muted)" }}>Month:</span>
              {flux.periods.map((p) => (
                <Link
                  key={p}
                  href={p === flux.period ? "/analytics" : `/analytics?period=${p}`}
                  className="rounded-full border px-2 py-0.5 text-[10px]"
                  style={
                    p === flux.period
                      ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 500 }
                      : { borderColor: "var(--border)", color: "var(--muted)" }
                  }
                >
                  {new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" })}
                  {p === new Date().toISOString().slice(0, 7) ? " · to date" : ""}
                </Link>
              ))}
            </div>
            <Waterfall
              startLabel={monthName(flux.prior).slice(0, 3)}
              start={profitPrior}
              items={[
                ...shown.map((r) => ({
                  label: r.name,
                  delta: r.contrib,
                  href: `/ledger/${r.code}?period=${flux.period}`,
                })),
                ...(otherContrib !== 0 ? [{ label: `Other (${fluxItems.length - shown.length})`, delta: otherContrib }] : []),
              ]}
              endLabel={monthName(flux.period).slice(0, 3)}
              end={profitThis}
            />
          </ChartCard>
        )}

        <ChartCard
          title={`P&L trend ${trend.year}`}
          question="Monthly movement for the six largest P&L lines (income and expenses both shown as positive amounts)."
          table={
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className={th}>Account</th>
                  {trend.months.map((m) => (
                    <th key={m} className={thR}>{m.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...byAccount.values()]
                  .sort((a, b) => a.code.localeCompare(b.code))
                  .map((a) => (
                    <tr key={a.code} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="py-1">
                        <Link href={`/ledger/${a.code}`} className="hover:underline">
                          {a.code} {a.name}
                        </Link>
                      </td>
                      {trend.months.map((m) => {
                        const v = a.values.get(m);
                        return (
                          <td key={m} className={numTd}>{v == null ? "–" : moneyCompact(v)}</td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          }
        >
          <TrendChart months={trend.months} series={trendSeries} />
        </ChartCard>

        {agingCard(arAging, "AR aging — who owes us", "/o2c", "collections")}
        {agingCard(apAging, "AP aging — who we owe", "/p2p/invoices", "invoices")}

        {counterpartyCard(
          customers,
          "Revenue by customer",
          "Where billed revenue concentrates (gross, by invoice month).",
          "/o2c/invoices",
          "AR invoices",
        )}
        {counterpartyCard(
          suppliers,
          "Spend by supplier",
          "Where invoiced spend concentrates (gross, excluding rejected).",
          "/p2p/invoices",
          "AP invoices",
        )}
      </div>

      <ChartCard
        title="Cash position"
        question="Cumulative bank balance by statement date — cash truth whether matched yet or not."
        controls={
          <Link href="/payments" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
            reconciliation →
          </Link>
        }
        table={
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className={th}>Month end</th>
                <th className={thR}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {monthEnds.map((p) => (
                <tr key={p.date} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1">{p.date}</td>
                  <td className={numTd}>{money(p.balanceMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <AreaTrend points={cashPoints} width={1320} height={260} />
      </ChartCard>
    </main>
  );
}
