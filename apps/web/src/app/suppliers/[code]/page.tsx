import Link from "next/link";
import { getJson } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";

type Detail = {
  supplier: { code: string; name: string; email: string | null; paymentTermsDays: number | null };
  purchases: { id: string; number: string; status: string; totalMinor: number; requestDate: string }[];
  invoices: { id: string; supplierInvoiceNumber: string; status: string; exceptionCode: string | null; grossMinor: number; invoiceDate: string }[];
};

export default async function SupplierPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const d = await getJson<Detail>(`/erp/suppliers/${code}`);
  if (!d) return <main>Supplier not found.</main>;

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/p2p", label: "P2P" }, { label: d.supplier.name }]} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">{d.supplier.name}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {d.supplier.code} · {d.supplier.email ?? "no email"} · terms {d.supplier.paymentTermsDays ?? "—"} days
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Purchases ({d.purchases.length})</SectionTitle>
          <ul className="space-y-1.5 text-sm">
            {d.purchases.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <span>
                  <Link href={`/p2p/purchases/${p.id}`} className="font-medium hover:underline">{p.number}</Link>{" "}
                  <Badge tone={toneForStatus(p.status)}>{p.status}</Badge>
                </span>
                <span className="tabular-nums">{money(p.totalMinor)}</span>
              </li>
            ))}
            {d.purchases.length === 0 && <li style={{ color: "var(--muted)" }}>None yet.</li>}
          </ul>
        </Card>
        <Card>
          <SectionTitle>Invoices ({d.invoices.length})</SectionTitle>
          <ul className="space-y-1.5 text-sm">
            {d.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between">
                <span>
                  <Link href={`/p2p/invoices/${i.id}`} className="font-medium hover:underline">{i.supplierInvoiceNumber}</Link>{" "}
                  <Badge tone={toneForStatus(i.status)}>{i.status}</Badge>{" "}
                  {i.exceptionCode && <Badge tone="warn">{i.exceptionCode}</Badge>}
                </span>
                <span className="tabular-nums">{money(i.grossMinor)} · {formatDate(i.invoiceDate)}</span>
              </li>
            ))}
            {d.invoices.length === 0 && <li style={{ color: "var(--muted)" }}>None yet.</li>}
          </ul>
        </Card>
      </section>
    </main>
  );
}
