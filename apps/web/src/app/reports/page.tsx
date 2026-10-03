import Link from "next/link";
import type { Metadata } from "next";
import { getJson } from "@/lib/api";
import { money } from "@/lib/format";
import { ApiDownBanner } from "@/components/Chrome";
import { Badge, Card, SectionTitle } from "@/components/ui";
import Commentary from "@/components/Commentary";

export const metadata: Metadata = { title: "Reports" };

type Statements = {
  basis: string;
  year: number;
  months: string[];
  pl: { code: string; name: string; type: string; period_code: string; amount_minor: number }[];
  bs: { code: string; name: string; type: string; period_code: string; balance_minor: number }[];
  plCumulative: { period_code: string; balance_minor: number }[];
};

/** debit-positive storage → display sign per statement convention */
const show = (minor: number) => money(minor);

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;
  const s = await getJson<Statements>(`/erp/statements${year ? `?year=${year}` : ""}`);

  if (!s)
    return (
      <main className="max-w-4xl space-y-5">
        <h2 className="text-2xl font-semibold tracking-tight">Reports</h2>
        <ApiDownBanner show />
      </main>
    );

  const months = s.months;
  const cell = (rows: typeof s.pl, code: string, m: string, field: "amount_minor") =>
    rows.find((r) => r.code === code && r.period_code === m)?.[field] ?? 0;
  const bsCell = (code: string, m: string) => {
    // cumulative: latest balance at or before month m
    const r = [...s.bs].filter((x) => x.code === code && x.period_code <= m).pop();
    return r?.balance_minor ?? 0;
  };

  const plAccounts = [...new Map(s.pl.map((r) => [r.code, r])).values()];
  const income = plAccounts.filter((a) => a.type === "income");
  const expense = plAccounts.filter((a) => a.type === "expense");
  const bsAccounts = [...new Map(s.bs.map((r) => [r.code, r])).values()];
  const profitAt = (m: string) =>
    [...s.plCumulative].filter((x) => x.period_code <= m).pop()?.balance_minor ?? 0;

  const sumRow = (accounts: typeof plAccounts, m: string, flip: boolean) =>
    accounts.reduce((n, a) => n + cell(s.pl, a.code, m, "amount_minor"), 0) * (flip ? -1 : 1);

  const table = (
    title: string,
    rows: { code: string; name: string }[],
    value: (code: string, m: string) => number,
    totalLabel: string,
    total: (m: string) => number,
  ) => (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2 pr-3">Account</th>
              {months.map((m) => (
                <th key={m} className="py-2 text-right">{m.slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.code} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5 pr-3">
                  <Link href={`/ledger/${a.code}`} className="hover:underline">
                    <span className="tabular-nums" style={{ color: "var(--muted)" }}>{a.code}</span> {a.name}
                  </Link>
                </td>
                {months.map((m) => (
                  <td key={m} className="py-1.5 text-right tabular-nums">{show(value(a.code, m))}</td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 pr-3">{totalLabel}</td>
              {months.map((m) => (
                <td key={m} className="py-1.5 text-right tabular-nums">{show(total(m))}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <main className="max-w-4xl space-y-6">
      <section className="flex items-baseline justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Financial statements — {s.year}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Monthly view, drillable to the ledger. <Badge>Live</Badge> basis — certified
            reporting arrives with the close lifecycle.
          </p>
        </div>
      </section>

      {table(
        "Profit & loss — month movements",
        [...income, ...expense].map((a) => ({ code: a.code, name: a.name })),
        (code, m) => {
          const raw = cell(s.pl, code, m, "amount_minor");
          const isIncome = income.some((a) => a.code === code);
          return isIncome ? -raw : raw; // income credit-positive for display
        },
        "Net cost / (profit)",
        (m) => sumRow([...income, ...expense], m, false),
      )}
      {income.length === 0 && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          No revenue yet — billing and receivables land with O2C (Phase 4).
        </p>
      )}

      {table(
        "Balance sheet — at month end",
        bsAccounts.map((a) => ({ code: a.code, name: a.name })),
        (code, m) => {
          const raw = bsCell(code, m);
          const acc = bsAccounts.find((a) => a.code === code)!;
          return acc.type === "asset" ? raw : -raw; // liabilities/equity credit-positive
        },
        "Retained profit / (loss) for period",
        (m) => -profitAt(m),
      )}

      <Commentary period={months[months.length - 1] ?? ""} months={months} />
    </main>
  );
}
