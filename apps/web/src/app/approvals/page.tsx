import Link from "next/link";
import { getJson } from "@/lib/api";
import { Badge, Card, SectionTitle } from "@/components/ui";
import DecideCommand from "@/components/DecideCommand";
import DecidePurchase from "@/components/DecidePurchase";

type Cmd = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  createdAt: string;
  requiresApproval: boolean;
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

const gbp = (minor: number) => `£${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

export default async function ApprovalsPage() {
  const [proposed, purchases] = await Promise.all([
    getJson<Cmd[]>("/commands?status=proposed"),
    getJson<PendingPurchase[]>("/p2p/purchases?status=requested"),
  ]);
  return (
    <main className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Approvals</h2>
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
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{c.type}</div>
                  <pre className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {JSON.stringify(c.params, null, 2)}
                  </pre>
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
