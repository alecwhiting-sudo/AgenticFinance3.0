import Link from "next/link";
import type { Metadata } from "next";
import { getJson } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { ApiDownBanner, Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";
import { DecideRun, ProposeRunButton, ReconcileButton } from "@/components/PaymentActions";

export const metadata: Metadata = { title: "Payments" };

type Run = {
  id: string;
  paymentRef: string;
  runDate: string;
  totalMinor: number;
  status: string;
  invoiceCount: number;
  invoices: { id: string; number: string; supplierName: string | null; grossMinor: number }[];
};

type BankTxn = {
  id: string;
  txnDate: string;
  amountMinor: number;
  reference: string;
  counterparty: string;
  kind: string;
  status: string;
};

export default async function PaymentsPage() {
  const [runs, bank] = await Promise.all([
    getJson<Run[]>("/p2p/payments"),
    getJson<BankTxn[]>("/p2p/bank?limit=120"),
  ]);
  const proposed = (runs ?? []).filter((r) => r.status === "proposed");
  const settled = (runs ?? []).filter((r) => r.status !== "proposed");
  const unmatched = (bank ?? []).filter((t) => t.status === "unmatched");

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/p2p", label: "P2P" }, { label: "Payments" }]} />
      <section className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Payments &amp; reconciliation</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Spend was approved at intent — the run is informational. Executing it
            moves money, so it always takes a human.
          </p>
        </div>
        <ProposeRunButton />
      </section>
      <ApiDownBanner show={runs === null} />

      <Card>
        <SectionTitle>Proposed runs ({proposed.length})</SectionTitle>
        <ul className="space-y-3">
          {proposed.map((r) => (
            <li key={r.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {r.paymentRef} · {formatDate(r.runDate)} ·{" "}
                    <span className="tabular-nums">{money(r.totalMinor)}</span> ·{" "}
                    {r.invoiceCount} invoice{r.invoiceCount === 1 ? "" : "s"}
                  </div>
                  <ul className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {r.invoices.map((i) => (
                      <li key={i.id}>
                        <Link href={`/p2p/invoices/${i.id}`} className="hover:underline">{i.number}</Link>{" "}
                        · {i.supplierName} · <span className="tabular-nums">{money(i.grossMinor)}</span>
                      </li>
                    ))}
                    {r.invoiceCount > r.invoices.length && <li>… and {r.invoiceCount - r.invoices.length} more</li>}
                  </ul>
                </div>
                <DecideRun paymentId={r.id} />
              </div>
            </li>
          ))}
          {proposed.length === 0 && (
            <li className="text-sm" style={{ color: "var(--muted)" }}>
              No runs waiting — propose one to sweep due posted invoices.
            </li>
          )}
        </ul>
      </Card>

      <Card>
        <SectionTitle>Run history ({settled.length})</SectionTitle>
        <table className="w-full text-sm">
          <tbody>
            {settled.slice(0, 25).map((r) => (
              <tr key={r.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5 font-medium">{r.paymentRef}</td>
                <td className="py-1.5"><Badge tone={toneForStatus(r.status)}>{r.status}</Badge></td>
                <td className="py-1.5 text-right tabular-nums">{r.invoiceCount} inv</td>
                <td className="py-1.5 text-right tabular-nums">{formatDate(r.runDate)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(r.totalMinor)}</td>
              </tr>
            ))}
            {settled.length === 0 && (
              <tr><td className="py-2 text-sm" style={{ color: "var(--muted)" }}>No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle>Bank feed — {unmatched.length} unmatched</SectionTitle>
          <ReconcileButton />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2">Reference</th>
              <th className="py-2">Counterparty</th>
              <th className="py-2">Kind</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Date</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(bank ?? []).slice(0, 60).map((t) => (
              <tr key={t.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5">{t.reference}</td>
                <td className="py-1.5" style={{ color: "var(--muted)" }}>{t.counterparty}</td>
                <td className="py-1.5" style={{ color: "var(--muted)" }}>{t.kind}</td>
                <td className="py-1.5"><Badge tone={t.status === "matched" ? "good" : "warn"}>{t.status}</Badge></td>
                <td className="py-1.5 text-right tabular-nums">{formatDate(t.txnDate)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(t.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
