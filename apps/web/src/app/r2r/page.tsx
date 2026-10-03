import Link from "next/link";
import type { Metadata } from "next";
import { getJson } from "@/lib/api";
import { money } from "@/lib/format";
import { ApiDownBanner } from "@/components/Chrome";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { RunMonthEndButton, ReconcileButton } from "@/components/R2RActions";

export const metadata: Metadata = { title: "R2R" };

type Status = {
  period: string;
  periods: string[];
  bank: { kind: string; status: string; n: number; total: string }[];
  monthEnd: { source_event_key: string; status: string }[];
  openExceptions: number;
  failedEvents: number;
};

export default async function R2RPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const s = await getJson<Status>(`/r2r/status${period ? `?period=${period}` : ""}`);
  if (!s)
    return (
      <main className="space-y-5">
        <h2 className="text-2xl font-semibold tracking-tight">Record to Report</h2>
        <ApiDownBanner show />
      </main>
    );

  const bankRow = (kind: string) => {
    const matched = s.bank.find((b) => b.kind === kind && b.status === "matched")?.n ?? 0;
    const open = s.bank.find((b) => b.kind === kind && b.status === "unmatched")?.n ?? 0;
    return { matched, open };
  };
  const kinds = [...new Set(s.bank.map((b) => b.kind))].sort();
  const totalOpen = s.bank.filter((b) => b.status === "unmatched").reduce((n, b) => n + b.n, 0);

  return (
    <main className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Record to Report</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Keep the books complete and explained — reconcile, post the month, read the story.
          </p>
        </div>
        <span className="flex items-center gap-3">
          <Link href="/reports" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            Financial statements
          </Link>
        </span>
      </section>

      <div className="flex flex-wrap gap-2">
        {s.periods.map((p) => (
          <Link
            key={p}
            href={`/r2r?period=${p}`}
            className="rounded-full border px-3 py-1 text-xs"
            style={{
              borderColor: "var(--border)",
              background: p === s.period ? "var(--card)" : "transparent",
              color: p === s.period ? "var(--foreground)" : "var(--muted)",
            }}
          >
            {p}
          </Link>
        ))}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <SectionTitle>Bank reconciliation</SectionTitle>
            <ReconcileButton />
          </div>
          <table className="w-full text-sm">
            <tbody>
              {kinds.map((k) => {
                const { matched, open } = bankRow(k);
                return (
                  <tr key={k} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-1.5">{k.replace(/_/g, " ")}</td>
                    <td className="py-1.5 text-right tabular-nums">{matched} matched</td>
                    <td className="py-1.5 text-right">
                      {open === 0 ? (
                        <Badge tone="good">clear</Badge>
                      ) : k === "ar_receipt" ? (
                        <Badge tone="warn">{open} unapplied</Badge>
                      ) : (
                        <Badge tone="warn">{open} open</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            {totalOpen === 0
              ? "Nothing needs a human — ambiguous lines go to the Reconciliation Agent from the "
              : `${totalOpen} line${totalOpen === 1 ? "" : "s"} need attention — investigate from the `}
            <Link href="/p2p/payments" className="hover:underline" style={{ color: "var(--accent)" }}>bank feed</Link>.
          </p>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <SectionTitle>Month-end postings — {s.period}</SectionTitle>
            <RunMonthEndButton period={s.period} />
          </div>
          {s.monthEnd.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Not run yet — prepayment releases, accruals (with auto-reversal) and
              recurring journals post through the platform in one click.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {s.monthEnd.map((e) => (
                <li key={e.source_event_key} className="flex items-center justify-between">
                  <span style={{ color: "var(--muted)" }}>{e.source_event_key.replace("period.tick:", "")}</span>
                  <Badge tone={e.status === "processed" ? "good" : e.status === "failed" ? "bad" : "warn"}>{e.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/p2p/invoices?status=exception">
          <Card className="!p-3 text-center">
            <div className="text-xl font-semibold tracking-tight">{s.openExceptions}</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>open exceptions</div>
          </Card>
        </Link>
        <Card className="!p-3 text-center">
          <div className="text-xl font-semibold tracking-tight">{s.failedEvents}</div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>failed events</div>
        </Card>
        <Link href="/ledger">
          <Card className="!p-3 text-center">
            <div className="text-xl font-semibold">TB</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>trial balance</div>
          </Card>
        </Link>
        <Link href="/approvals">
          <Card className="!p-3 text-center">
            <div className="text-xl font-semibold">✓</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>approvals inbox</div>
          </Card>
        </Link>
      </section>
    </main>
  );
}
