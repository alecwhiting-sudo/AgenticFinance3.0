import Link from "next/link";
import type { Metadata } from "next";
import { getJson } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { ApiDownBanner, Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, toneForStatus } from "@/components/ui";

export const metadata: Metadata = { title: "Invoices" };

type Invoice = {
  id: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  invoiceDate: string;
  grossMinor: number;
  status: string;
  exceptionCode: string | null;
  format: string;
};

const STAGES = ["all", "captured", "matched", "exception", "approved", "posted", "scheduled", "paid", "rejected"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = status && status !== "all" ? status : undefined;
  const invoices = await getJson<Invoice[]>(
    `/p2p/invoices?limit=100${filter ? `&status=${filter}` : ""}`,
  );

  return (
    <main className="space-y-5">
      <Breadcrumbs trail={[{ href: "/p2p", label: "P2P" }, { label: "Invoices" }]} />
      <h2 className="text-2xl font-semibold tracking-tight">Supplier invoices</h2>
      <ApiDownBanner show={invoices === null} />

      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <Link
            key={s}
            href={s === "all" ? "/p2p/invoices" : `/p2p/invoices?status=${s}`}
            className="rounded-full border px-3 py-1 text-xs"
            style={{
              borderColor: "var(--border)",
              background: (s === "all" && !filter) || s === filter ? "var(--card)" : "transparent",
              color: (s === "all" && !filter) || s === filter ? "var(--foreground)" : "var(--muted)",
            }}
          >
            {s}
          </Link>
        ))}
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2">Invoice</th>
              <th className="py-2">Supplier</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Date</th>
              <th className="py-2 text-right">Gross</th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).map((i) => (
              <tr key={i.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">
                  <Link href={`/p2p/invoices/${i.id}`} className="font-medium hover:underline">
                    {i.supplierInvoiceNumber}
                  </Link>
                </td>
                <td className="py-2">{i.supplierName}</td>
                <td className="py-2">
                  <Badge tone={toneForStatus(i.status)}>{i.status}</Badge>{" "}
                  {i.exceptionCode && <Badge tone="warn">{i.exceptionCode}</Badge>}{" "}
                  {i.format === "ubl_xml" && <Badge>xml</Badge>}
                  {i.format === "scan_pdf" && <Badge>scan</Badge>}
                </td>
                <td className="py-2 text-right tabular-nums">{formatDate(i.invoiceDate)}</td>
                <td className="py-2 text-right tabular-nums">{money(i.grossMinor)}</td>
              </tr>
            ))}
            {invoices !== null && invoices.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-sm" style={{ color: "var(--muted)" }}>
                  No invoices in this stage — drip one from the P2P page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
