import Link from "next/link";
import { getJson, PUBLIC_API_URL } from "@/lib/api";
import { money, formatDate, formatDateTime } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";
import { ChaseButton } from "@/components/O2CActions";

type Detail = {
  invoice: {
    id: string;
    number: string;
    invoiceDate: string;
    dueDate: string;
    lines: { lineNo: number; description: string; qty: number; unitPriceMinor: number; accountCode: string }[];
    netMinor: number;
    vatMinor: number;
    grossMinor: number;
    status: string;
    overdue: boolean;
    documentPath: string | null;
    contractPath: string | null;
    remittancePath: string | null;
  };
  customer: { code: string; name: string; paymentTermsDays: number | null } | null;
  dunning: { id: string; text: string; sentBy: string; createdAt: string }[];
  journal: { id: string; number: number; journalDate: string } | null;
  receiptJournal: { id: string; number: number; journalDate: string } | null;
};

export default async function ArInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getJson<Detail>(`/o2c/invoices/${id}`);
  if (!d) return <main>Invoice not found.</main>;
  const inv = d.invoice;
  const doc = (path: string | null, label: string) =>
    path && (
      <a key={label} href={`${PUBLIC_API_URL}/${path}`} target="_blank" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)" }}>
        {label} ↗
      </a>
    );

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/o2c", label: "O2C" }, { label: inv.number }]} />
      <section className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {inv.number} <Badge tone={toneForStatus(inv.status)}>{inv.status}</Badge>{" "}
            {inv.overdue && <Badge tone="bad">overdue</Badge>}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {d.customer ? (
              <Link href={`/customers/${d.customer.code}`} className="hover:underline">{d.customer.name}</Link>
            ) : "Unknown customer"}{" "}
            · invoiced {formatDate(inv.invoiceDate)} · due {formatDate(inv.dueDate)}
          </p>
        </div>
        <span className="flex items-center gap-2">
          {doc(inv.documentPath, "Invoice PDF")}
          {doc(inv.contractPath, "Contract")}
          {doc(inv.remittancePath, "Remittance")}
          {inv.overdue && <ChaseButton invoiceId={inv.id} />}
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
                  <td className="py-1.5 pl-3 text-right text-xs">
                    <Link href={`/ledger/${l.accountCode}`} className="hover:underline" style={{ color: "var(--muted)" }}>{l.accountCode}</Link>
                  </td>
                </tr>
              ))}
              <tr><td className="py-1.5" colSpan={2}>Net</td><td className="py-1.5 text-right tabular-nums">{money(inv.netMinor)}</td></tr>
              <tr><td className="py-1.5" colSpan={2}>VAT</td><td className="py-1.5 text-right tabular-nums">{money(inv.vatMinor)}</td></tr>
            </tbody>
          </table>
          <p className="mt-3 space-x-3 text-sm">
            {d.journal && (
              <Link href={`/journals/${d.journal.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                billed: journal #{d.journal.number}
              </Link>
            )}
            {d.receiptJournal && (
              <Link href={`/journals/${d.receiptJournal.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                paid: journal #{d.receiptJournal.number}
              </Link>
            )}
          </p>
        </Card>
        <Card>
          <SectionTitle>Collections history</SectionTitle>
          <ol className="space-y-3">
            {d.dunning.map((l) => (
              <li key={l.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
                <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>
                  {formatDateTime(l.createdAt)} · approved by {l.sentBy}
                </div>
                <p className="whitespace-pre-line leading-6">{l.text}</p>
              </li>
            ))}
            {d.dunning.length === 0 && (
              <li className="text-sm" style={{ color: "var(--muted)" }}>No chase letters sent.</li>
            )}
          </ol>
        </Card>
      </section>
    </main>
  );
}
