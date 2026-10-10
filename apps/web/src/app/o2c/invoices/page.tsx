import Link from "next/link";
import type { Metadata } from "next";
import { getJson } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { ApiDownBanner, Breadcrumbs } from "@/components/Chrome";
import { Badge, Card, toneForStatus } from "@/components/ui";
import { ChaseButton } from "@/components/O2CActions";

export const metadata: Metadata = { title: "AR invoices" };

/** The AR invoice list (the Receivables page keeps the pipeline overview;
 * this is the full, filterable register the nav's Invoices entry opens). */

type Invoice = {
  id: string;
  number: string;
  customerName: string;
  customerCode: string;
  invoiceDate: string;
  dueDate: string;
  grossMinor: number;
  status: string;
  overdue: boolean;
};

const FILTERS = ["all", "posted", "overdue", "paid"];

export default async function ArInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const filter = view && view !== "all" ? view : undefined;
  const query =
    filter === "overdue" ? "?overdue=true&limit=200" : filter ? `?status=${filter}&limit=200` : "?limit=200";
  const invoices = await getJson<Invoice[]>(`/o2c/invoices${query}`);

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/o2c", label: "Order to Cash" }, { label: "Invoices" }]} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">AR invoices</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Every sales invoice on the ledger — filter by status, drill into any invoice for its lines,
          postings and collection history.
        </p>
      </section>
      <ApiDownBanner show={invoices === null} />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/o2c/invoices" : `/o2c/invoices?view=${f}`}
            className="rounded-full border px-3 py-1 text-xs"
            style={{
              borderColor: "var(--border)",
              background: (f === "all" && !filter) || f === filter ? "var(--card)" : "transparent",
              color: (f === "all" && !filter) || f === filter ? "var(--foreground)" : "var(--muted)",
            }}
          >
            {f}
          </Link>
        ))}
        <span className="self-center text-xs" style={{ color: "var(--muted)" }}>
          {invoices?.length ?? 0} shown (newest first, up to 200)
        </span>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2">Invoice</th>
              <th className="py-2">Customer</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Issued</th>
              <th className="py-2 text-right">Due</th>
              <th className="py-2 text-right">Gross</th>
              <th className="py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).map((i) => (
              <tr key={i.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">
                  <Link href={`/o2c/invoices/${i.id}`} className="font-medium hover:underline">{i.number}</Link>
                </td>
                <td className="py-2">
                  <Link href={`/customers/${i.customerCode}`} className="hover:underline">{i.customerName}</Link>
                </td>
                <td className="py-2">
                  <Badge tone={toneForStatus(i.status)}>{i.status}</Badge>{" "}
                  {i.overdue && <Badge tone="bad">overdue</Badge>}
                </td>
                <td className="py-2 text-right tabular-nums">{formatDate(i.invoiceDate)}</td>
                <td className="py-2 text-right tabular-nums">{formatDate(i.dueDate)}</td>
                <td className="py-2 text-right tabular-nums">{money(i.grossMinor)}</td>
                <td className="py-2 text-right">{i.overdue && <ChaseButton invoiceId={i.id} />}</td>
              </tr>
            ))}
            {invoices !== null && invoices.length === 0 && (
              <tr><td colSpan={7} className="py-3 text-sm" style={{ color: "var(--muted)" }}>Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
