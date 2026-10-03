import Link from "next/link";
import type { Metadata } from "next";
import { getJson } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { ApiDownBanner } from "@/components/Chrome";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";
import { ApplyReceiptsButton, ChaseButton } from "@/components/O2CActions";

export const metadata: Metadata = { title: "O2C" };

type Pipeline = {
  statuses: { status: string; n: number; total: string }[];
  aging: { bucket: string; n: number; total: string }[];
  openReceipts: number;
};
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
const AGING_LABELS: Record<string, string> = { current: "current", d30: "1–30 days", d60: "31–60 days", d90: "60+ days" };

export default async function O2CPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const filter = view && view !== "all" ? view : undefined;
  const query =
    filter === "overdue" ? "?overdue=true&limit=100" : filter ? `?status=${filter}&limit=100` : "?limit=100";
  const [pipeline, invoices] = await Promise.all([
    getJson<Pipeline>("/o2c/pipeline"),
    getJson<Invoice[]>(`/o2c/invoices${query}`),
  ]);
  const apiDown = pipeline === null;
  const st = (s: string) => pipeline?.statuses.find((x) => x.status === s);
  const outstanding = Number(st("posted")?.total ?? 0);

  return (
    <main className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Order to Cash</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Billing to banked — receipts applied by rule, chased by agent, approved by you.
          </p>
        </div>
        <ApplyReceiptsButton />
      </section>
      <ApiDownBanner show={apiDown} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="!p-3 text-center">
          <div className="text-xl font-semibold tracking-tight">{money(outstanding)}</div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>receivables outstanding</div>
        </Card>
        {["posted", "paid"].map((s) => (
          <Link key={s} href={`/o2c?view=${s}`}>
            <Card className="!p-3 text-center">
              <div className="text-xl font-semibold tracking-tight">{st(s)?.n ?? 0}</div>
              <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{s === "posted" ? "open invoices" : "paid"}</div>
            </Card>
          </Link>
        ))}
        <Card className="!p-3 text-center">
          <div className="text-xl font-semibold tracking-tight">{pipeline?.openReceipts ?? 0}</div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>unapplied receipts</div>
        </Card>
      </section>

      <Card>
        <SectionTitle>AR aging — open invoices by due date</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {["current", "d30", "d60", "d90"].map((b) => {
            const row = pipeline?.aging.find((a) => a.bucket === b);
            return (
              <div key={b} className="rounded-lg border p-3 text-center" style={{ borderColor: b === "d90" && row?.n ? "var(--bad)" : "var(--border)" }}>
                <div className="text-lg font-semibold tracking-tight">{money(Number(row?.total ?? 0))}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {AGING_LABELS[b]} · {row?.n ?? 0} inv
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/o2c" : `/o2c?view=${f}`}
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
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2">Invoice</th>
              <th className="py-2">Customer</th>
              <th className="py-2">Status</th>
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
                <td className="py-2 text-right tabular-nums">{formatDate(i.dueDate)}</td>
                <td className="py-2 text-right tabular-nums">{money(i.grossMinor)}</td>
                <td className="py-2 text-right">{i.overdue && <ChaseButton invoiceId={i.id} />}</td>
              </tr>
            ))}
            {invoices !== null && invoices.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-sm" style={{ color: "var(--muted)" }}>Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
