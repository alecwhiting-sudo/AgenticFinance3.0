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
  lastPosted: string;
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
  const v = await getJson<Variance>(`/pm/variance${q}`).catch(() => null);
  if (!v)
    return (
      <main>
        <PageHeader title="Performance" context="No active budget yet." />
      </main>
    );

  const periods = [...new Set(v.cells.filter((c) => c.actualMinor !== 0).map((c) => c.periodCode))].sort();
  const hasForecast = v.forecast !== null;
  // two honest comparisons: the window's landing (forecast = actuals to
  // date + forecast months) against the window's budget, and actuals so
  // far against the budget FOR THOSE MONTHS ONLY — never against budget
  // for months that haven't happened.
  const byAccount = new Map<string, { budget: number; forecast: number; actualYtd: number; budgetYtd: number }>();
  for (const c of v.cells) {
    const t = byAccount.get(c.accountCode) ?? { budget: 0, forecast: 0, actualYtd: 0, budgetYtd: 0 };
    t.budget += c.budgetMinor;
    t.forecast += c.forecastMinor;
    if (c.periodCode <= v.lastPosted) {
      t.actualYtd += c.actualMinor;
      t.budgetYtd += c.budgetMinor;
    }
    byAccount.set(c.accountCode, t);
  }
  const rows = v.accounts
    .map((a) => {
      const t = byAccount.get(a.code) ?? { budget: 0, forecast: 0, actualYtd: 0, budgetYtd: 0 };
      return {
        ...a,
        ...t,
        varFcstBudgMinor: contribution(t.forecast) - contribution(t.budget),
        varActBudgMinor: contribution(t.actualYtd) - contribution(t.budgetYtd),
      };
    })
    .filter((r) => r.budget !== 0 || r.actualYtd !== 0 || r.forecast !== 0);
  const income = rows.filter((r) => r.type === "income");
  const expense = rows.filter((r) => r.type === "expense");
  const sum = (xs: { budget: number; forecast: number; actualYtd: number; budgetYtd: number }[]) =>
    xs.reduce(
      (t, x) => ({
        budget: t.budget + x.budget,
        forecast: t.forecast + x.forecast,
        actualYtd: t.actualYtd + x.actualYtd,
        budgetYtd: t.budgetYtd + x.budgetYtd,
      }),
      { budget: 0, forecast: 0, actualYtd: 0, budgetYtd: 0 },
    );
  const rev = sum(income);
  const cost = sum(expense);
  const resultBudget = contribution(rev.budget + cost.budget);
  const resultForecast = contribution(rev.forecast + cost.forecast);
  const resultActualYtd = contribution(rev.actualYtd + cost.actualYtd);
  const resultBudgetYtd = contribution(rev.budgetYtd + cost.budgetYtd);
  const postedLabel = monthName(v.lastPosted);

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
          {hasForecast && <VarCell varMinor={r.varFcstBudgMinor} budgetMinor={r.budget} />}
          <td className="border-l py-1.5 pl-3 text-right tabular-nums" style={{ borderColor: "var(--border)" }}>
            {money(contribution(r.actualYtd))}
          </td>
          <VarCell varMinor={r.varActBudgMinor} budgetMinor={r.budgetYtd} />
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

      <section className={`grid grid-cols-2 gap-3 ${hasForecast ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {hasForecast && (
          <Kpi
            label="FY landing vs budget"
            value={moneyCompact(resultForecast)}
            hint={`budget ${moneyCompact(resultBudget)} · ${resultForecast >= resultBudget ? "+" : "−"}${moneyCompact(Math.abs(resultForecast - resultBudget))} — ${v.forecast!.code}`}
            href="/pm/forecast"
          />
        )}
        <Kpi
          label={`Revenue to ${postedLabel}`}
          value={moneyCompact(contribution(rev.actualYtd))}
          hint={`budget ${moneyCompact(contribution(rev.budgetYtd))} · ${contribution(rev.actualYtd) >= contribution(rev.budgetYtd) ? "+" : "−"}${moneyCompact(Math.abs(contribution(rev.actualYtd) - contribution(rev.budgetYtd)))}`}
        />
        <Kpi
          label={`Result to ${postedLabel}`}
          value={moneyCompact(resultActualYtd)}
          hint={`budget ${moneyCompact(resultBudgetYtd)} · ${resultActualYtd >= resultBudgetYtd ? "+" : "−"}${moneyCompact(Math.abs(resultActualYtd - resultBudgetYtd))}`}
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
            {/* two header rows: the PERIOD each column group covers, then the
                columns — full-year plan figures and to-date actuals never
                share a label again */}
            <tr style={{ color: "var(--muted)" }}>
              <th />
              <th
                colSpan={hasForecast ? 3 : 1}
                className="border-b pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.15em]"
                style={{ borderColor: "var(--border)", color: "var(--accent)" }}
              >
                {windowLabel}
              </th>
              <th
                colSpan={2}
                className="border-b border-l pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.15em]"
                style={{ borderColor: "var(--border)", color: "var(--accent)" }}
              >
                To {postedLabel} (posted)
              </th>
            </tr>
            <tr style={{ color: "var(--muted)" }}>
              <th className="py-1.5 text-left text-[10px] uppercase tracking-wide">Account</th>
              <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Budget</th>
              {hasForecast && <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Forecast landing</th>}
              {hasForecast && <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Variance (fav +)</th>}
              <th className="border-l py-1.5 pl-3 text-right text-[10px] uppercase tracking-wide" style={{ borderColor: "var(--border)" }}>
                Actual
              </th>
              <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">vs budget to {postedLabel} (fav +)</th>
            </tr>
          </thead>
          <tbody>
            {section("Revenue", income)}
            {section("Costs", expense)}
            <tr className="border-t-2 font-semibold" style={{ borderColor: "var(--border)" }}>
              <td className="py-2">Result</td>
              <td className="py-2 text-right tabular-nums">{money(resultBudget)}</td>
              {hasForecast && <td className="py-2 text-right tabular-nums">{money(resultForecast)}</td>}
              {hasForecast && <VarCell varMinor={resultForecast - resultBudget} budgetMinor={rev.budget + cost.budget} />}
              <td className="border-l py-2 pl-3 text-right tabular-nums" style={{ borderColor: "var(--border)" }}>
                {money(resultActualYtd)}
              </td>
              <VarCell varMinor={resultActualYtd - resultBudgetYtd} budgetMinor={rev.budgetYtd + cost.budgetYtd} />
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Variance is favourable-positive: revenue above plan and costs below plan both read green. Every account
          drills to its ledger.{hasForecast ? ` The forecast is the full-year landing — actuals through ${postedLabel}, then forecast months — so "Fcast vs budg" is the landing gap; "Act vs budg" compares only the months that have happened.` : ""}
        </p>
      </section>
    </main>
  );
}
