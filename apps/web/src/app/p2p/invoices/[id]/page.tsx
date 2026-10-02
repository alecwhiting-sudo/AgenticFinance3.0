import Link from "next/link";
import { getJson, PUBLIC_API_URL } from "@/lib/api";
import { money, formatDate, formatDateTime } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";

type Detail = {
  invoice: {
    id: string;
    supplierInvoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    lines: { lineNo: number; description: string; qty: number; unitPriceMinor: number; accountCode: string }[];
    netMinor: number;
    vatMinor: number;
    grossMinor: number;
    status: string;
    exceptionCode: string | null;
    documentPath: string | null;
    emailPath: string | null;
    format: string;
  };
  supplier: { code: string; name: string } | null;
  purchase: { id: string; number: string; status: string } | null;
  caseEvents: { at: string; actorType: string; actorId: string; kind: string; detail: Record<string, unknown> }[];
  journal: { id: string; number: number; journalDate: string } | null;
};

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getJson<Detail>(`/p2p/invoices/${id}`);
  if (!d) return <main>Invoice not found.</main>;
  const inv = d.invoice;

  return (
    <main className="space-y-6">
      <Breadcrumbs
        trail={[
          { href: "/p2p", label: "P2P" },
          { href: "/p2p/invoices", label: "Invoices" },
          { label: inv.supplierInvoiceNumber },
        ]}
      />
      <section className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {inv.supplierInvoiceNumber} <Badge tone={toneForStatus(inv.status)}>{inv.status}</Badge>{" "}
            {inv.exceptionCode && <Badge tone="warn">{inv.exceptionCode}</Badge>}{" "}
            {inv.format === "ubl_xml" && <Badge>e-invoice</Badge>}
            {inv.format === "scan_pdf" && <Badge>scanned</Badge>}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {d.supplier ? (
              <Link href={`/suppliers/${d.supplier.code}`} className="hover:underline">
                {d.supplier.name}
              </Link>
            ) : "Unknown supplier"}{" "}
            · invoiced {formatDate(inv.invoiceDate)} · due {formatDate(inv.dueDate)}
            {d.purchase && (
              <>
                {" "}· against{" "}
                <Link href={`/p2p/purchases/${d.purchase.id}`} className="hover:underline">
                  {d.purchase.number}
                </Link>
              </>
            )}
          </p>
        </div>
        <span className="flex gap-2">
          {inv.documentPath && (
            <a href={`${PUBLIC_API_URL}/${inv.documentPath}`} target="_blank" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)" }}>
              {inv.format === "ubl_xml" ? "Invoice XML ↗" : inv.format === "scan_pdf" ? "Scanned PDF ↗" : "Invoice PDF ↗"}
            </a>
          )}
          {inv.emailPath && (
            <a href={`${PUBLIC_API_URL}/${inv.emailPath}`} target="_blank" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)" }}>
              Email ↗
            </a>
          )}
        </span>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Lines — {money(inv.grossMinor)} gross</SectionTitle>
          <table className="w-full text-sm">
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.lineNo} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5">{l.description}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.qty} × {money(l.unitPriceMinor)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">{money(l.qty * l.unitPriceMinor)}</td>
                  <td className="py-1.5 pl-3 text-right text-xs">
                    <Link href={`/ledger/${l.accountCode}`} className="hover:underline" style={{ color: "var(--muted)" }}>
                      {l.accountCode}
                    </Link>
                  </td>
                </tr>
              ))}
              <tr><td className="py-1.5" colSpan={2}>Net</td><td className="py-1.5 text-right tabular-nums" colSpan={2}>{money(inv.netMinor)}</td></tr>
              <tr><td className="py-1.5" colSpan={2}>VAT</td><td className="py-1.5 text-right tabular-nums" colSpan={2}>{money(inv.vatMinor)}</td></tr>
              <tr className="font-semibold"><td className="py-1.5" colSpan={2}>Gross</td><td className="py-1.5 text-right tabular-nums" colSpan={2}>{money(inv.grossMinor)}</td></tr>
            </tbody>
          </table>
          {d.journal && (
            <p className="mt-3 text-sm">
              Posted as{" "}
              <Link href={`/journals/${d.journal.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                journal #{d.journal.number}
              </Link>{" "}
              on {formatDate(d.journal.journalDate)}
            </p>
          )}
        </Card>
        <Card>
          <SectionTitle>Case history</SectionTitle>
          <ol className="relative space-y-3 border-l pl-5" style={{ borderColor: "var(--border)" }}>
            {d.caseEvents.map((e, i) => (
              <li key={i}>
                <span className="absolute -left-[5px] mt-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />
                <div className="text-sm">
                  <b>{e.kind}</b> — {String(e.detail.detail ?? e.detail.note ?? e.detail.rationale ?? JSON.stringify(e.detail).slice(0, 160))}
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {formatDateTime(e.at)} · {e.actorId}
                </div>
              </li>
            ))}
            {d.caseEvents.length === 0 && (
              <li className="text-sm" style={{ color: "var(--muted)" }}>
                No case — this invoice flowed straight through.
              </li>
            )}
          </ol>
        </Card>
      </section>
    </main>
  );
}
