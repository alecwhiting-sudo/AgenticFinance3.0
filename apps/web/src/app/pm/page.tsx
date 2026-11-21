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
  budget: { id: string; code: string; label: string; kind: string };
  window: { from: string; to: string };
  accounts: { code: string; name: string; type: string }[];
  cells: { accountCode: string; periodCode: string; budgetMinor: number; actualMinor: number }[];
};

/** Ledger sign is debit-positive; profit contribution flips it. Favourable
 * variance = contribution(actual) above contribution(budget). */
const contribution = (ledgerMinor: number) => -ledgerMinor;

const monthName = (p: string) =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export default async function PmPage({ searchParams }: { searchParams: Promise<{ lens?: string; vs?: string }> }) {
  const { lens, vs } = await searchParams;
  const L = parsePeriodLens(lens);
  const vsForecast = vs === "forecast";
  const params = new URLSearchParams();
  if (L) {
    params.set("from", L.from);
    params.set("to", L.to);
  }
  if (vsForecast) params.set("vs", "forecast");
  const q = params.size > 0 ? `?${params.toString()}` : "";
  const v = await getJson<Variance>(`/pm/variance${q}`).catch(() => null);
  if (!v)
    return (
      <main>
        <PageHeader
          title="Performance"
          context={
            vsForecast ? (
              <>
                No adopted forecast yet — draft and adopt one on the{" "}
                <Link href="/pm/forecast" className="underline" style={{ color: "var(--accent)" }}>Forecast page</Link>, or{" "}
                <Link href="/pm" className="underline" style={{ color: "var(--accent)" }}>compare against the budget</Link>.
              </>
            ) : (
              "No active budget yet — it seeds on deploy (plans/PM.md M1)."
            )
          }
        />
      </main>
    );

  const periods = [...new Set(v.cells.filter((c) => c.actualMinor !== 0).map((c) => c.periodCode))].sort();
  const byAccount = new Map<string, { budget: number; actual: number }>();
  for (const c of v.cells) {
    const t = byAccount.get(c.accountCode) ?? { budget: 0, actual: 0 };
    t.budget += c.budgetMinor;
    t.actual += c.actualMinor;
    byAccount.set(c.accountCode, t);
  }
  const rows = v.accounts
    .map((a) => {
      const t = byAccount.get(a.code) ?? { budget: 0, actual: 0 };
      return { ...a, ...t, varMinor: contribution(t.actual) - contribution(t.budget) };
    })
    .filter((r) => r.budget !== 0 || r.actual !== 0);
  const income = rows.filter((r) => r.type === "income");
  const expense = rows.filter((r) => r.type === "expense");
  const sum = (xs: { budget: number; actual: number }[]) =>
    xs.reduce((t, x) => ({ budget: t.budget + x.budget, actual: t.actual + x.actual }), { budget: 0, actual: 0 });
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

  const section = (label: string, xs: typeof rows) => (
    <>
      <tr>
        <td colSpan={4} className="pt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
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
          <td className="py-1.5 text-right tabular-nums">{money(contribution(r.actual))}</td>
          <VarCell varMinor={r.varMinor} budgetMinor={r.budget} />
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
            Actuals against <span className="font-medium">{v.budget.label}</span> ({v.budget.code})
            {vsForecast ? " — the forecast you adopted." : " — a driver-based budget: every line derives from named assumptions, nothing is typed in."}{" "}
            Window: {windowLabel}. Compare vs{" "}
            <Link href={`/pm${lens ? `?lens=${encodeURIComponent(lens)}` : ""}`} className={vsForecast ? "underline" : "font-semibold"} style={{ color: "var(--accent)" }}>
              budget
            </Link>{" "}
            ·{" "}
            <Link
              href={`/pm?vs=forecast${lens ? `&lens=${encodeURIComponent(lens)}` : ""}`}
              className={vsForecast ? "font-semibold" : "underline"}
              style={{ color: "var(--accent)" }}
            >
              forecast
            </Link>{" "}
            ·{" "}
            <Link href="/pm/forecast" className="underline" style={{ color: "var(--accent)" }}>
              manage versions →
            </Link>
          </>
        }
        actions={<PeriodPicker periods={periods} lens={lens} />}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          label={vsForecast ? "Comparing against" : "Budget"}
          value={v.budget.code}
          hint={vsForecast ? "the adopted forecast — manage on /pm/forecast" : "driver-based — drafts & adoption on /pm/forecast"}
          href="/pm/forecast"
        />
      </section>

      <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              <th className="py-1.5 text-left text-[10px] uppercase tracking-wide">Account</th>
              <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Budget</th>
              <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Actual</th>
              <th className="py-1.5 text-right text-[10px] uppercase tracking-wide">Variance (fav +)</th>
            </tr>
          </thead>
          <tbody>
            {section("Revenue", income)}
            {section("Costs", expense)}
            <tr className="border-t-2 font-semibold" style={{ borderColor: "var(--border)" }}>
              <td className="py-2">Result</td>
              <td className="py-2 text-right tabular-nums">{money(resultBudget)}</td>
              <td className="py-2 text-right tabular-nums">{money(resultActual)}</td>
              <VarCell varMinor={resultActual - resultBudget} budgetMinor={rev.budget + cost.budget} />
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Variance is favourable-positive: revenue above budget and costs below budget both read green. Every account
          drills to its ledger. Signs follow the books (plans are never journals — this table is a query over both).
        </p>
      </section>
    </main>
  );
}
