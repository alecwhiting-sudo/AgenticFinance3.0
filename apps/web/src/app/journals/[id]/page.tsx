import Link from "next/link";
import { getJson, PUBLIC_API_URL } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Card, SectionTitle } from "@/components/ui";

type Detail = {
  journal: { id: string; number: number; journalDate: string; memo: string; sourceType: string; postedBy: string };
  lines: { lineNo: number; accountCode: string; accountName: string; amountMinor: number; memo: string | null }[];
  source: { kind: string; id: string; label: string; documentPath?: string | null } | null;
};

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getJson<Detail>(`/erp/journals/${id}`);
  if (!d) return <main>Journal not found.</main>;
  const total = d.lines.reduce((n, l) => n + l.amountMinor, 0);

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/ledger", label: "Ledger" }, { label: `Journal #${d.journal.number}` }]} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Journal #{d.journal.number}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {formatDate(d.journal.journalDate)} · {d.journal.memo} · posted by {d.journal.postedBy}
          {d.source && (
            <>
              {" "}· source:{" "}
              {d.source.kind === "ap_invoice" ? (
                <Link href={`/p2p/invoices/${d.source.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                  {d.source.label}
                </Link>
              ) : (
                <span>{d.source.label}</span>
              )}
              {d.source.documentPath && (
                <>
                  {" "}
                  <a href={`${PUBLIC_API_URL}/${d.source.documentPath}`} target="_blank" className="hover:underline" style={{ color: "var(--accent)" }}>
                    (PDF ↗)
                  </a>
                </>
              )}
            </>
          )}
        </p>
      </section>

      <Card>
        <SectionTitle>Lines {total === 0 ? "· ✓ balanced" : "· ✗ UNBALANCED"}</SectionTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2">Account</th>
              <th className="py-2">Memo</th>
              <th className="py-2 text-right">Debit</th>
              <th className="py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.lineNo} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5">
                  <Link href={`/ledger/${l.accountCode}`} className="hover:underline">
                    {l.accountCode} {l.accountName}
                  </Link>
                </td>
                <td className="py-1.5" style={{ color: "var(--muted)" }}>{l.memo}</td>
                <td className="py-1.5 text-right tabular-nums">{l.amountMinor > 0 ? money(l.amountMinor) : ""}</td>
                <td className="py-1.5 text-right tabular-nums">{l.amountMinor < 0 ? money(-l.amountMinor) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
