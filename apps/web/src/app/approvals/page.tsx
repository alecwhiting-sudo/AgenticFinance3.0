import type { Metadata } from "next";
import Link from "next/link";
import { getJson } from "@/lib/api";
import { Badge, Card, SectionTitle } from "@/components/ui";
import DecideCommand from "@/components/DecideCommand";
import DecidePurchase from "@/components/DecidePurchase";

export const metadata: Metadata = { title: "Approvals" };

type Cmd = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  createdAt: string;
  requiresApproval: boolean;
  agentName: string;
  context: Record<string, unknown> | null;
};
type PendingPurchase = {
  id: string;
  number: string;
  supplierName: string;
  requestedBy: string;
  businessNeed: string;
  approvalBand: string | null;
  totalMinor: number;
};

import { money as gbp } from "@/lib/format";

export default async function ApprovalsPage() {
  const [proposed, purchases] = await Promise.all([
    getJson<Cmd[]>("/commands?status=proposed"),
    getJson<PendingPurchase[]>("/p2p/purchases?status=requested"),
  ]);
  return (
    <main className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Approvals</h2>
        <Link href="/decisions" className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
          Decision history →
        </Link>
      </div>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Everything a human must decide, in one inbox. Spend is approved once —
        here, at the moment of intent; clean invoices then flow straight
        through.
      </p>
      <Card>
        <SectionTitle>Purchases awaiting approval ({purchases?.length ?? 0})</SectionTitle>
        <ul className="space-y-3">
          {(purchases ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <div>
                <div className="text-sm font-medium">
                  <Link href={`/p2p/purchases/${p.id}`} className="hover:underline">{p.number}</Link> · {p.supplierName}{" "}
                  <Badge tone="warn">{p.approvalBand} band</Badge>{" "}
                  <span className="tabular-nums">{gbp(p.totalMinor)}</span>
                </div>
                <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                  {p.requestedBy} — {p.businessNeed}
                </div>
              </div>
              <DecidePurchase purchaseId={p.id} />
            </li>
          ))}
          {(purchases ?? []).length === 0 && (
            <li className="text-sm" style={{ color: "var(--muted)" }}>No purchases waiting.</li>
          )}
        </ul>
      </Card>
      <Card>
        <SectionTitle>Commands awaiting decision ({(proposed ?? []).length})</SectionTitle>
        <ul className="space-y-3">
          {(proposed ?? []).map((c) => (
            <li key={c.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  {c.context ? (
                    <>
                      <div className="text-sm font-medium">
                        {c.context.kind === "bank" ? (
                          <>
                            post bank line {String(c.context.reference)} · {String(c.context.counterparty)} ·{" "}
                            <span className="tabular-nums">{gbp(Number(c.context.amountMinor))}</span> → account{" "}
                            <Link href={`/ledger/${String(c.context.accountCode)}`} className="hover:underline">{String(c.context.accountCode)}</Link>
                          </>
                        ) : c.context.kind === "receipt" ? (
                          <>
                            apply receipt {String(c.context.reference)} ({gbp(Number(c.context.amountMinor))}) to{" "}
                            <Link href={`/o2c/invoices/${String(c.context.invoiceId)}`} className="hover:underline">{String(c.context.invoiceNumber)}</Link>
                          </>
                        ) : c.context.kind === "dunning" ? (
                          <>
                            send chase letter for{" "}
                            <Link href={`/o2c/invoices/${String(c.context.invoiceId)}`} className="hover:underline">{String(c.context.invoiceNumber)}</Link>{" "}
                            · <span className="tabular-nums">{gbp(Number(c.context.grossMinor))}</span> · was due {String(c.context.dueDate)}
                          </>
                        ) : (
                          <>
                            {String(c.params.resolution ?? c.type).replace(/_/g, " ")} ·{" "}
                            <Link href={`/p2p/invoices/${String(c.context.invoiceId)}`} className="hover:underline">
                              {String(c.context.invoiceNumber)}
                            </Link>{" "}
                            · {String(c.context.supplierName ?? "unknown supplier")}{" "}
                            <span className="tabular-nums">{gbp(Number(c.context.grossMinor))}</span>{" "}
                            {c.context.exceptionCode ? <Badge tone="warn">{String(c.context.exceptionCode)}</Badge> : null}
                          </>
                        )}
                      </div>
                      {c.context.kind === "dunning" && typeof c.params.text === "string" && (
                        <p className="mt-2 whitespace-pre-line rounded-lg border p-2 text-xs leading-5" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                          {c.params.text}
                        </p>
                      )}
                      {typeof c.params.rationale === "string" && (
                        <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                          “{c.params.rationale}”
                        </div>
                      )}
                      <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                        proposed by {c.agentName}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-medium">{c.type} · proposed by {c.agentName}</div>
                      <pre className="mt-1 overflow-x-auto text-xs" style={{ color: "var(--muted)" }}>
                        {JSON.stringify(c.params, null, 2)}
                      </pre>
                    </>
                  )}
                </div>
                <DecideCommand commandId={c.id} />
              </div>
            </li>
          ))}
          {(proposed ?? []).length === 0 && (
            <li className="text-sm" style={{ color: "var(--muted)" }}>Nothing awaiting approval.</li>
          )}
        </ul>
      </Card>
    </main>
  );
}
