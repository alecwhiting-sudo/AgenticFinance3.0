import type { Metadata } from "next";
import Link from "next/link";
import { parsePeriodLens } from "@af/shared";
import { getJson } from "@/lib/api";
import { Card, SectionTitle } from "@/components/ui";
import PeriodPicker from "@/components/PeriodPicker";

export const metadata: Metadata = { title: "Ledger" };

type TB = {
  accounts: { code: string; name: string; type: string; balance_minor: number }[];
  controlTotalMinor: number;
  journals: number;
  from: string | null;
  to: string | null;
  periods: string[];
};

const gbp = (minor: number) =>
  `${minor < 0 ? "(" : ""}£${(Math.abs(minor) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}${minor < 0 ? ")" : ""}`;

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ lens?: string }>;
}) {
  const { lens } = await searchParams;
  const L = parsePeriodLens(lens);
  const tb = await getJson<TB>(`/erp/trial-balance${L ? `?from=${L.from}&to=${L.to}` : ""}`);
  if (!tb) return <main>Ledger unavailable.</main>;
  const nonZero = tb.accounts.filter((a) => a.balance_minor !== 0);
  const drillQ = L ? `?from=${L.from}&to=${L.to}` : "";

  return (
    <main className="max-w-4xl space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Trial balance{L ? ` — ${L.label}` : ""}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {tb.journals} journals {L ? "in this window" : "posted"} · control total {gbp(tb.controlTotalMinor)}{" "}
            {tb.controlTotalMinor === 0 ? "✓ in balance" : "✗ OUT OF BALANCE"}
            {L ? " · movements in the window, not cumulative balances" : ""}
          </p>
        </div>
        <PeriodPicker periods={tb.periods} lens={lens} />
      </section>

      {TYPE_ORDER.map((type) => {
        const rows = nonZero.filter((a) => a.type === type);
        if (rows.length === 0) return null;
        const subtotal = rows.reduce((n, a) => n + a.balance_minor, 0);
        return (
          <Card key={type}>
            <SectionTitle>{type}</SectionTitle>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((a) => (
                  <tr key={a.code} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-1.5 pr-3 tabular-nums" style={{ color: "var(--muted)" }}>{a.code}</td>
                    <td className="py-1.5">
                      <Link href={`/ledger/${a.code}${drillQ}`} className="hover:underline">{a.name}</Link>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{gbp(a.balance_minor)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td />
                  <td className="py-1.5">Total {type}</td>
                  <td className="py-1.5 text-right tabular-nums">{gbp(subtotal)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        );
      })}
    </main>
  );
}
