import type { Metadata } from "next";
import Link from "next/link";
import { parsePeriodLens } from "@af/shared";
import { getJson } from "@/lib/api";
import { money, moneyCompact } from "@/lib/format";
import { Kpi, PageHeader } from "@/components/ui";
import PeriodPicker from "@/components/PeriodPicker";

export const metadata: Metadata = { title: "Performance" };

/** Performance Management M1 (plans/PM.md): actuals against the ACTIVE
 * driver-based budget. Plans are never journals — this page is a query
 * over both, on the shared period lens, drilling to the ledger like every
 * other number in the workbench. */

type Variance = {
  budget: { id: string; code: string; label: string };
  forecast: { id: string; code: string; label: string } | null;
  window: { from: string; to: string };
  accounts: { code: string; name: string; type: string }[];
  cells: { accountCode: string; periodCode: string; budgetMinor: number; forecastMinor: number; actualMinor: number }[];
};

/** Ledger sign is debit-positive; profit contribution flips it. Favourable
 * variance = contribution(actual) above contribution(budget). */
const contribution = (ledgerMinor: number) => -ledgerMinor;

const monthName = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export default async function PmPage({ searchParams }: { searchParams: Promise<{ lens?: string }> }) {
  const { lens } = await searchParams;
  const L = parsePeriodLens(lens);
  const params = new URLSearchParams();
  if (L) {
    params.set("from", L.from);
    params.set("to", L.to);
  }
  const q = params.size > 0 ? `?${params.toString()}` : "";
  const [v, landingRes] = await Promise.all([
    getJson<Variance>(`/pm/variance${q}`).catch(() => null),
    getJson<{ landing: { code: string; revenueMinor: number; resultMinor: number } | null }>(`/pm/landing`).catch(() => null),
  ]);
  const landing = landingRes?.landing ?? null;
  if (!v)
    return (
      <main>
        <PageHeader title="Performance" context="No active budget yet." />
      </main>
    );

  const periods = [...new Set(v.cells.filter((c) => c.actualMinor !== 0).map((c) => c.periodCode))].sort();
  const hasForecast = v.forecast !== null;
  const byAccount = new Map<string, { budget: number; forecast: number; actual: number }>();
  for (const c of v.cells) {
    const t = byAccount.get(c.accountCode) ?? { budget: 0, forecast: 0, actual: 0 };
    t.budget += c.budgetMinor;
    t.forecast += c.forecastMinor;
    t.actual += c.actualMinor;
    byAccount.set(c.accountCode, t);
  }
  const rows = v.accounts
    .map((a) => {
      const t = byAccount.get(a.code) ?? { budget: 0, forecast: 0, actual: 0 };
      return {
        ...a,
        ...t,
        varBudgMinor: contribution(t.actual) - contribution(t.budget),
        varFcstMinor: contribution(t.actual) - contribution(t.forecast),
      };
    })
    .filter((r) => r.budget !== 0 || r.actual !== 0 || r.forecast !== 0);
  const income = rows.filter((r) => r.type === "income");
  const expense = rows.filter((r) => r.type === "expense");
  const sum = (xs: { budget: number; forecast: number; actual: number }[]) =>
    xs.reduce(
      (t, x) => ({ budget: t.budget + x.budget, forecast: t.forecast + x.forecast, actual: t.actual + x.actual }),
      { budget: 0, forecast: 0, actual: 0 },
    );
  const rev = sum(income);
  const cost = sum(expense);
  const resultBudget = contribution(rev.budget + cost.budget);
  const resultActual = contribution(rev.actual + cost.actual);

  const windowLabel =
    v.window.from === v.window.to ? monthName(v.window.from) : `${monthName(v.window.from)} – ${monthName(v.window.to)}`;

  const pct = (varMinor: number, budgetMinor: number) =>
    budgetMinor !== 0 ? `${((varMinor / Math.abs(contribution(budgetMinor))) * 100).toFixed(1)}%` : "—";

  const VarCell = ({ varMinor, budgetMinor }: { varMinor: number; budgetMinor: number }) => (
    <td className="py-1.5 text-right tabular-nums" style={{ color: varMinor === 0 ? "var(--muted)" : varMinor > 0 ? "var(--good)" : "var(--bad)" }}>
      {varMinor > 0 ? "+" : ""}
      {money(varMinor)} <span className="text-xs">({pct(varMinor, budgetMinor)})</span>
    </td>
  );

  const cols = hasForecast ? 6 : 4;
  const section = (label: string, xs: typeof rows) => (
    <>
      <tr>
        <td colSpan={cols} className="pt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          {label}
        </td>
      </tr>
      {xs.map((r) => (
        <tr key={r.code} className="border-t" style={{ borderColor: "var(--border)" }}>
          <td className="py-1.5">
            <Link href={`/ledger/${r.code}${lens ? `?lens=${encodeURIComponent(lens)}` : ""}`} className="hover:underline">
              <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>{r.code}</span> {r.name}
            </Link>
          </td>
          <td className="py-1.5 text-right tabular-nums">{money(contribution(r.budget))}</td>
          {hasForecast && <td className="py-1.5 text-right tabular-nums">{money(contribution(r.forecast))}</td>}
          <td className="py-1.5 text-right tabular-nums">{money(contribution(r.actual))}</td>
          <VarCell varMinor={r.varBudgMinor} budgetMinor={r.budget} />
          {hasForecast && <VarCell varMinor={r.varFcstMinor} budgetMinor={r.forecast} />}
        </tr>
      ))}
    </>
  );

  return (
    <main className="space-y-6">
      <PageHeader
        title="Performance"
        context={
          <>
            Actuals against the budget ({v.budget.code})
            {v.forecast ? ` and the adopted forecast (${v.forecast.code})` : ""} — each variance says which it
            measures. Window: {windowLabel}.{" "}
            <Link href="/pm/forecast" className="underline" style={{ color: "var(--accent)" }}>
              Manage budget &amp; forecasts →
            </Link>
          </>
        }
        actions={<PeriodPicker periods={periods} lens={lens} />}
      />

      <section className={`grid grid-cols-2 gap-3 ${landing ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {landing && (
          <Kpi
            label="FY landing"
            value={moneyCompact(landing.resultMinor)}
            hint={`full-year result per ${landing.code} — revenue ${moneyCompact(landing.revenueMinor)}`}
            href="/pm/forecast"
          />
        )}
        <Kpi
          label="Revenue vs budget"
          value={moneyCompact(contribution(rev.actual))}
          hint={`budget ${moneyCompact(contribution(rev.budget))} · ${contribution(rev.actual) >= contribution(rev.budget) ? "+" : "−"}${moneyCompact(Math.abs(contribution(rev.actual) - contribution(rev.budget)))}`}
        />
        <Kpi
          label="Costs vs budget"
          value={moneyCompact(cost.actual)}
          hint={`budget ${moneyCompact(cost.budget)} · ${cost.actual <= cost.budget ? "" : "+"}${moneyCompact(cost.actual - cost.budget)} vs plan`}
        />
        <Kpi
          label="Result vs budget"
          value={moneyCompact(resultActual)}
          hint={`budget ${moneyCompact(resultBudget)} · ${resultActual >= resultBudget ? "+" : "−"}${moneyCompact(Math.abs(resultActual - resultBudget))}`}
        />
        <Kpi
          label="Comparing against"
          value={v.forecast ? `${v.budget.code} + ${v.forecast.code}` : v.budget.code}
          hint={v.forecast ? "budget and adopted forecast, side by side" : "the budget — adopt a forecast to compare both"}
          href="/pm/forecast"
        />
      </section>

      <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              <th className="py-1.5 text-left text-[10px] uppercase tracking-wide">Account</th>
              <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Budget</th>
              {hasForecast && <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Forecast</th>}
              <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Actual</th>
              <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Act vs budg (fav +)</th>
              {hasForecast && <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Act vs fcast (fav +)</th>}
            </tr>
          </thead>
          <tbody>
            {section("Revenue", income)}
            {section("Costs", expense)}
            <tr className="border-t-2 font-semibold" style={{ borderColor: "var(--border)" }}>
              <td className="py-2">Result</td>
              <td className="py-2 text-right tabular-nums">{money(resultBudget)}</td>
              {hasForecast && <td className="py-2 text-right tabular-nums">{money(contribution(rev.forecast + cost.forecast))}</td>}
              <td className="py-2 text-right tabular-nums">{money(resultActual)}</td>
              <VarCell varMinor={resultActual - resultBudget} budgetMinor={rev.budget + cost.budget} />
              {hasForecast && (
                <VarCell
                  varMinor={resultActual - contribution(rev.forecast + cost.forecast)}
                  budgetMinor={rev.forecast + cost.forecast}
                />
              )}
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Variance is favourable-positive: revenue above plan and costs below plan both read green. Every account
          drills to its ledger.{hasForecast ? " Months the rolling forecast already carries as actuals show no actual-vs-forecast variance — the forecast columns earn their keep as new months post." : ""}
        </p>
      </section>
    </main>
  );
}
