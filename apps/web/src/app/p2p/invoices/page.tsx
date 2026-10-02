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
const FORMATS = [
  { key: "all", label: "any format" },
  { key: "text_pdf", label: "pdf" },
  { key: "scan_pdf", label: "scanned" },
  { key: "ubl_xml", label: "e-invoice" },
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; format?: string }>;
}) {
  const { status, format } = await searchParams;
  const filter = status && status !== "all" ? status : undefined;
  const formatFilter = format && format !== "all" ? format : undefined;
  const invoices = await getJson<Invoice[]>(
    `/p2p/invoices?limit=100${filter ? `&status=${filter}` : ""}${formatFilter ? `&format=${formatFilter}` : ""}`,
  );
  const href = (s?: string, f?: string) => {
    const params = new URLSearchParams();
    if (s && s !== "all") params.set("status", s);
    if (f && f !== "all") params.set("format", f);
    const q = params.toString();
    return q ? `/p2p/invoices?${q}` : "/p2p/invoices";
  };

  return (
    <main className="space-y-5">
      <Breadcrumbs trail={[{ href: "/p2p", label: "P2P" }, { label: "Invoices" }]} />
      <h2 className="text-2xl font-semibold tracking-tight">Supplier invoices</h2>
      <ApiDownBanner show={invoices === null} />

      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <Link
            key={s}
            href={href(s, formatFilter)}
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
      <div className="flex flex-wrap gap-2">
        {FORMATS.map((f) => (
          <Link
            key={f.key}
            href={href(filter, f.key)}
            className="rounded-full border px-3 py-1 text-xs"
            style={{
              borderColor: "var(--border)",
              background: (f.key === "all" && !formatFilter) || f.key === formatFilter ? "var(--card)" : "transparent",
              color: (f.key === "all" && !formatFilter) || f.key === formatFilter ? "var(--foreground)" : "var(--muted)",
            }}
          >
            {f.label}
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
