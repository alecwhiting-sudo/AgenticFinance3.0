import Link from "next/link";
import { getJson } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";

type Detail = {
  customer: { code: string; name: string; email: string | null; paymentTermsDays: number | null };
  invoices: { id: string; number: string; status: string; overdue: boolean; grossMinor: number; invoiceDate: string; dueDate: string }[];
};

export default async function CustomerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const d = await getJson<Detail>(`/erp/customers/${code}`);
  if (!d) return <main>Customer not found.</main>;
  const open = d.invoices.filter((i) => i.status === "posted");
  const exposure = open.reduce((n, i) => n + i.grossMinor, 0);

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/o2c", label: "O2C" }, { label: d.customer.name }]} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">{d.customer.name}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {d.customer.code} · {d.customer.email ?? "no email"} · terms {d.customer.paymentTermsDays ?? "—"} days ·
          outstanding {money(exposure)} across {open.length} open invoice{open.length === 1 ? "" : "s"}
        </p>
      </section>
      <Card>
        <SectionTitle>Invoices ({d.invoices.length})</SectionTitle>
        <ul className="space-y-1.5 text-sm">
          {d.invoices.map((i) => (
            <li key={i.id} className="flex items-center justify-between">
              <span>
                <Link href={`/o2c/invoices/${i.id}`} className="font-medium hover:underline">{i.number}</Link>{" "}
                <Badge tone={toneForStatus(i.status)}>{i.status}</Badge>{" "}
                {i.overdue && <Badge tone="bad">overdue</Badge>}
              </span>
              <span className="tabular-nums">{money(i.grossMinor)} · due {formatDate(i.dueDate)}</span>
            </li>
          ))}
          {d.invoices.length === 0 && <li style={{ color: "var(--muted)" }}>None yet.</li>}
        </ul>
      </Card>
    </main>
  );
}
