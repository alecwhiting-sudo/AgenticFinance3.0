import Link from "next/link";
import { getJson } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Card, SectionTitle } from "@/components/ui";

type Detail = {
  account: { code: string; name: string; type: string };
  lines: {
    amount_minor: number;
    line_memo: string | null;
    journal_id: string;
    number: number;
    journal_date: string;
    memo: string;
    source_type: string;
  }[];
};

export default async function AccountPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const d = await getJson<Detail>(`/erp/accounts/${code}`);
  if (!d) return <main>Account not found.</main>;
  const balance = d.lines.reduce((n, l) => n + l.amount_minor, 0);

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/ledger", label: "Ledger" }, { label: `${d.account.code} ${d.account.name}` }]} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">
          {d.account.code} · {d.account.name}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {d.account.type} · balance {money(balance)} · {d.lines.length} postings shown
        </p>
      </section>
      <Card>
        <SectionTitle>Journal lines</SectionTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2">Journal</th>
              <th className="py-2">Memo</th>
              <th className="py-2 text-right">Date</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5">
                  <Link href={`/journals/${l.journal_id}`} className="font-medium hover:underline">
                    #{l.number}
                  </Link>
                </td>
                <td className="py-1.5" style={{ color: "var(--muted)" }}>{l.memo}</td>
                <td className="py-1.5 text-right tabular-nums">{formatDate(l.journal_date)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(l.amount_minor)}</td>
              </tr>
            ))}
            {d.lines.length === 0 && (
              <tr><td colSpan={4} className="py-3" style={{ color: "var(--muted)" }}>No postings yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
