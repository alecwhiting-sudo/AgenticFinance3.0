import Link from "next/link";
import { getJson, PUBLIC_API_URL } from "@/lib/api";
import { Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";

type Detail = {
  purchase: {
    id: string;
    number: string;
    requestedBy: string;
    businessNeed: string;
    requestDate: string;
    approvalBand: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    orderDate: string | null;
    lines: { lineNo: number; description: string; qty: number; unitPriceMinor: number; accountCode: string }[];
    totalMinor: number;
    status: string;
    documentPath: string | null;
  };
  supplier: { name: string; email: string | null; paymentTermsDays: number | null } | null;
  receipts: { number: string; receiptDate: string; quantities: { lineNo: number; qtyReceived: number }[] }[];
  invoices: {
    id: string;
    supplierInvoiceNumber: string;
    invoiceDate: string;
    grossMinor: number;
    status: string;
    exceptionCode: string | null;
    documentPath: string | null;
  }[];
};

import { money as gbp } from "@/lib/format";

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getJson<Detail>(`/p2p/purchases/${id}`);
  if (!d) return <main>Purchase not found.</main>;
  const p = d.purchase;

  const thread: { when: string | null; what: string; who: string; doc?: string | null }[] = [
    { when: p.requestDate, what: `Requested — ${p.businessNeed}`, who: p.requestedBy },
    ...(p.approvedAt
      ? [{
          when: p.approvedAt.slice(0, 10),
          what: p.status === "rejected" ? "Rejected" : `Approved (${p.approvalBand} band) — supplier view issued`,
          who: p.approvedBy ?? "",
        }]
      : [{ when: null, what: `Awaiting ${p.approvalBand} approval`, who: "" }]),
    ...d.receipts.map((r) => ({
      when: r.receiptDate,
      what: `Goods receipt ${r.number} — ${r.quantities.map((q) => `line ${q.lineNo}: ${q.qtyReceived}`).join(", ")}`,
      who: "ops",
    })),
    ...d.invoices.map((i) => ({
      when: i.invoiceDate,
      what: `Invoice ${i.supplierInvoiceNumber} (${gbp(i.grossMinor)}) — ${i.status}${i.exceptionCode ? ` · ${i.exceptionCode}` : ""}`,
      who: d.supplier?.name ?? "supplier",
      doc: i.documentPath,
    })),
  ];

  return (
    <main className="space-y-6">
      <div className="print:hidden">
        <Breadcrumbs trail={[{ href: "/p2p", label: "P2P" }, { label: p.number }]} />
      </div>
      <section className="flex items-start justify-between print:hidden">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {p.number} <Badge tone={toneForStatus(p.status)}>{p.status}</Badge>{" "}
            {p.approvalBand && <Badge>{p.approvalBand} band</Badge>}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            One record from intent to payment — requisition and PO are the same thing here.
          </p>
        </div>
        <span className="flex gap-2">
        {p.documentPath && (
          <a
            href={`${PUBLIC_API_URL}/${p.documentPath}`}
            target="_blank"
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            PO PDF ↗
          </a>
        )}
        <Link
          href={`/p2p/purchases/${p.id}/view`}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)" }}
        >
          Supplier view ↗
        </Link>
        </span>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>The thread</SectionTitle>
          <ol className="relative space-y-3 border-l pl-5" style={{ borderColor: "var(--border)" }}>
            {thread.map((t, i) => (
              <li key={i}>
                <span
                  className="absolute -left-[5px] mt-1.5 inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: t.when ? "var(--accent)" : "var(--border)" }}
                />
                <div className="text-sm">
                  {t.what}
                  {t.doc && (
                    <a
                      href={`${PUBLIC_API_URL}/${t.doc}`}
                      target="_blank"
                      className="ml-2 text-xs hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      PDF ↗
                    </a>
                  )}
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {t.when ?? "pending"}{t.who ? ` · ${t.who}` : ""}
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <SectionTitle>{d.supplier?.name ?? "Supplier"} — {gbp(p.totalMinor)} ex VAT</SectionTitle>
          <table className="w-full text-sm">
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.lineNo} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5">{l.description}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.qty} × {gbp(l.unitPriceMinor)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">{gbp(l.qty * l.unitPriceMinor)}</td>
                  <td className="py-1.5 pl-3 text-right text-xs" style={{ color: "var(--muted)" }}>{l.accountCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </main>
  );
}
