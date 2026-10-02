import Link from "next/link";
import { getJson } from "@/lib/api";
import { Badge, Card, SectionTitle, Stat, toneForStatus } from "@/components/ui";

type Pipeline = {
  invoiceStages: { status: string; n: number }[];
  purchaseStages: { status: string; n: number }[];
  bands: { band: string | null; n: number }[];
  exceptions: { code: string | null; n: number }[];
};
type Invoice = {
  id: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  invoiceDate: string;
  grossMinor: number;
  status: string;
  exceptionCode: string | null;
};
type Purchase = {
  id: string;
  number: string;
  supplierName: string;
  requestedBy: string;
  businessNeed: string;
  approvalBand: string | null;
  totalMinor: number;
  status: string;
};

const gbp = (minor: number) => `£${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
const INVOICE_STAGES = ["captured", "matched", "exception", "approved", "posted", "scheduled", "paid"];

export default async function P2PPage() {
  const [pipeline, exceptions, purchases] = await Promise.all([
    getJson<Pipeline>("/p2p/pipeline"),
    getJson<Invoice[]>("/p2p/invoices?status=exception&limit=50"),
    getJson<Purchase[]>("/p2p/purchases?limit=12"),
  ]);
  const stageCount = (s: string) => pipeline?.invoiceStages.find((x) => x.status === s)?.n ?? 0;
  const bandCount = (b: string) => pipeline?.bands.find((x) => x.band === b)?.n ?? 0;

  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Procure to Pay</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          One Purchase from intent to payment — approved once, straight through unless an
          exception fires.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-7">
        {INVOICE_STAGES.map((s) => (
          <Card key={s} className="!p-3 text-center">
            <div className="text-xl font-semibold tabular-nums">{stageCount(s)}</div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{s}</div>
          </Card>
        ))}
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Stat label="Auto-approved" value={bandCount("auto")} hint="standing authority, logged" />
        <Stat label="Standard band" value={bandCount("standard")} hint="one approver, one click" />
        <Stat label="Director band" value={bandCount("director")} hint="over £5,000 or new supplier" />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Open exceptions ({exceptions?.length ?? 0})</SectionTitle>
          <ul className="space-y-2">
            {(exceptions ?? []).map((i) => (
              <li key={i.id} className="flex items-center justify-between text-sm">
                <div>
                  <Badge tone="warn">{i.exceptionCode}</Badge>{" "}
                  <span className="font-medium">{i.supplierName}</span>{" "}
                  <span style={{ color: "var(--muted)" }}>{i.supplierInvoiceNumber}</span>
                </div>
                <span className="tabular-nums">{gbp(i.grossMinor)}</span>
              </li>
            ))}
            {(exceptions ?? []).length === 0 && (
              <li className="text-sm" style={{ color: "var(--muted)" }}>No open exceptions.</li>
            )}
          </ul>
        </Card>
        <Card>
          <SectionTitle>Recent purchases</SectionTitle>
          <ul className="space-y-2">
            {(purchases ?? []).map((p) => (
              <li key={p.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    <Link href={`/p2p/purchases/${p.id}`} className="font-medium hover:underline">{p.number}</Link> · {p.supplierName}{" "}
                    <Badge tone={toneForStatus(p.status)}>{p.status}</Badge>{" "}
                    {p.approvalBand && <Badge>{p.approvalBand}</Badge>}
                  </span>
                  <span className="tabular-nums">{gbp(p.totalMinor)}</span>
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {p.requestedBy} — {p.businessNeed}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </main>
  );
}
