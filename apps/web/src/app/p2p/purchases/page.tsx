import type { Metadata } from "next";
import Link from "next/link";
import { getJson } from "@/lib/api";
import { money } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, toneForStatus } from "@/components/ui";

export const metadata: Metadata = { title: "Purchases" };

type Purchase = {
  id: string;
  number: string;
  supplierName: string;
  requestedBy: string;
  businessNeed: string;
  requestDate: string;
  approvalBand: string | null;
  totalMinor: number;
  status: string;
  qtyOrdered: number;
  qtyReceived: number;
  receiptCount: number;
  invoiceCount: number;
  invoiceExceptions: number;
};

const STATUSES = ["requested", "approved", "partially_received", "received", "closed", "rejected", "cancelled"];

/** Requisition and PO are one record (plans/P2P.md): the list shows each
 * purchase's 3-way-match state — ordered vs received vs invoiced. */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const qs = status ? `?status=${status}&limit=200` : "?limit=200";
  const purchases = (await getJson<Purchase[]>(`/p2p/purchases${qs}`)) ?? [];

  const received = (p: Purchase) =>
    p.receiptCount === 0 ? "—" : `${p.qtyReceived}/${p.qtyOrdered}`;

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/p2p", label: "P2P" }, { label: "Purchases" }]} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Purchases &amp; receipts</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Requisition and purchase order are one internal record; goods receipts land against it,
          and the invoice is matched to both — mismatches fire exceptions.
        </p>
      </section>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/p2p/purchases"
          className="rounded-lg border px-3 py-1"
          style={{ borderColor: !status ? "var(--accent)" : "var(--border)", color: !status ? "var(--accent)" : undefined }}
        >
          all
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/p2p/purchases?status=${s}`}
            className="rounded-lg border px-3 py-1"
            style={{ borderColor: status === s ? "var(--accent)" : "var(--border)", color: status === s ? "var(--accent)" : undefined }}
          >
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2">Purchase</th>
              <th className="py-2">Supplier</th>
              <th className="py-2">Requested</th>
              <th className="py-2">Band</th>
              <th className="py-2 text-right">Total ex VAT</th>
              <th className="py-2 text-center">Status</th>
              <th className="py-2 text-right">Received qty</th>
              <th className="py-2 text-right">Invoices</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5">
                  <Link href={`/p2p/purchases/${p.id}`} className="font-medium hover:underline">
                    {p.number}
                  </Link>
                  <div className="max-w-[28ch] truncate text-xs" style={{ color: "var(--muted)" }}>
                    {p.businessNeed}
                  </div>
                </td>
                <td className="py-1.5">{p.supplierName}</td>
                <td className="py-1.5 text-xs" style={{ color: "var(--muted)" }}>
                  {p.requestDate} · {p.requestedBy}
                </td>
                <td className="py-1.5">{p.approvalBand && <Badge>{p.approvalBand}</Badge>}</td>
                <td className="py-1.5 text-right tabular-nums">{money(p.totalMinor)}</td>
                <td className="py-1.5 text-center">
                  <Badge tone={toneForStatus(p.status)}>{p.status.replace("_", " ")}</Badge>
                </td>
                <td
                  className="py-1.5 text-right tabular-nums"
                  style={p.receiptCount > 0 && p.qtyReceived < p.qtyOrdered ? { color: "var(--warn)" } : undefined}
                  title={p.receiptCount > 0 ? `${p.receiptCount} goods receipt${p.receiptCount > 1 ? "s" : ""}` : "no goods receipt yet"}
                >
                  {received(p)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {p.invoiceCount}
                  {p.invoiceExceptions > 0 && (
                    <span className="ml-1">
                      <Badge tone="warn">{p.invoiceExceptions} exc</Badge>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {purchases.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-sm" style={{ color: "var(--muted)" }}>
                  No purchases{status ? ` with status ${status}` : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
