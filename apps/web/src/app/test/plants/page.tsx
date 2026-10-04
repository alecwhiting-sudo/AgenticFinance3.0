import type { Metadata } from "next";
import Link from "next/link";
import { getJson } from "@/lib/api";
import { money, formatDate } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Card, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Test data map" };

/** The live test data map (plans/DATASET_V2.md PR-D): every flaw planted in
 * the demo dataset, with details and dates — derived from the committed
 * dataset itself (/admin/dataset/plants) so it can never drift from the
 * data. Deliberately NOT in the main navigation: this is the answer sheet,
 * reached from the Test panel. */

type Plant = {
  code: string;
  fraud: boolean;
  control: string;
  chainId: string;
  invoiceNumber: string;
  supplier: string;
  invoiceDate: string;
  grossMinor: number;
  format: string;
  detail: string;
};
type Special = {
  kind: "multi_page" | "poor_scan";
  chainId: string;
  invoiceNumber: string;
  supplier: string;
  invoiceDate: string;
  grossMinor: number;
  pages?: number;
  layout?: string;
  trap?: boolean;
  detail: string;
};
type Plants = {
  meta: { seed: number; from: string; to: string; version: number };
  totals: { apChains: number; planted: number; byCode: Record<string, number> };
  plants: Plant[];
  special: Special[];
};

const CODE_LABELS: Record<string, string> = {
  price_variance: "Price variance",
  qty_short_receipt: "Short receipt",
  missing_receipt: "Missing receipt",
  no_purchase: "No purchase record",
  duplicate_suspect: "Duplicate suspect",
  bank_detail_change: "Bank detail change (email)",
  bank_detail_mismatch: "IBAN mismatch vs master",
  total_mismatch: "Stated total ≠ line sum",
};

const WHAT_IT_SIMULATES: Record<string, string> = {
  price_variance: "supplier bills above the agreed PO price",
  qty_short_receipt: "billed quantity exceeds goods received",
  missing_receipt: "PO exists but no goods receipt was ever booked",
  no_purchase: "invoice arrives with no PO — unapproved spend",
  duplicate_suspect: "same supplier re-bills: same number, or same amount within days",
  bank_detail_change: "a covering email asks to redirect payment — a fraud attempt",
  bank_detail_mismatch: "the IBAN printed on the invoice differs from the supplier master — a fraud attempt",
  total_mismatch: "a multi-page invoice whose stated grand total does not equal the sum of its lines",
};

const FORMAT_LABELS: Record<string, string> = {
  text_pdf: "text PDF",
  ubl_xml: "UBL e-invoice",
  scan_pdf: "scan",
};

const th = "py-1.5 pr-3 text-left text-[10px] uppercase tracking-wide";
const thR = "py-1.5 text-right text-[10px] uppercase tracking-wide";

export default async function PlantsPage() {
  const d = await getJson<Plants>("/admin/dataset/plants");
  if (!d) return <main>The API is unavailable.</main>;

  const codes = [...new Set(d.plants.map((p) => p.code))];
  const multiPage = d.special.filter((s) => s.kind === "multi_page");
  const poorScans = d.special.filter((s) => s.kind === "poor_scan");

  const fraudBadge = (
    <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
      fraud risk
    </span>
  );

  const rowsTable = (rows: Plant[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            <th className={th}>Invoice</th>
            <th className={th}>Supplier</th>
            <th className={th}>Date</th>
            <th className={thR}>Gross</th>
            <th className={`${th} pl-3`}>Arrives as</th>
            <th className={`${th} pl-3`}>What is planted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.chainId} className="border-b align-top last:border-0" style={{ borderColor: "var(--border)" }}>
              <td className="py-1.5 pr-3 font-medium tabular-nums whitespace-nowrap">{p.invoiceNumber}</td>
              <td className="py-1.5 pr-3">{p.supplier}</td>
              <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{formatDate(p.invoiceDate)}</td>
              <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{money(p.grossMinor)}</td>
              <td className="py-1.5 pl-3 whitespace-nowrap" style={{ color: "var(--muted)" }}>{FORMAT_LABELS[p.format] ?? p.format}</td>
              <td className="py-1.5 pl-3" style={{ color: "var(--muted)" }}>{p.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/test", label: "Test panel" }, { label: "Test data map" }]} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Test data map — the answer sheet</h2>
        <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>
          Every flaw deliberately planted in the demo dataset (v{d.meta.version}, {d.meta.from} – {d.meta.to}, seed{" "}
          {d.meta.seed}): {d.totals.planted} planted exceptions across {d.totals.apChains} supplier invoice chains,
          plus the extraction challenges below. Derived live from the committed dataset, so it cannot drift from the
          data. If a run catches everything on this page, the controls are doing their job; anything caught that is
          NOT on this page deserves a look. Narrative version: <code>docs/plans/TEST_DATA_MAP.md</code>.
        </p>
      </section>

      {/* summary chips */}
      <section className="flex flex-wrap gap-2">
        {Object.entries(d.totals.byCode).map(([code, n]) => (
          <span key={code} className="rounded-full border px-2.5 py-1 text-xs tabular-nums" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            {n} × {CODE_LABELS[code] ?? code}
          </span>
        ))}
        <span className="rounded-full border px-2.5 py-1 text-xs tabular-nums" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          {multiPage.length} × multi-page invoice
        </span>
        <span className="rounded-full border px-2.5 py-1 text-xs tabular-nums" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          {poorScans.length} × poor-quality scan
        </span>
      </section>

      {/* extraction challenges */}
      <Card>
        <SectionTitle>Multi-page invoices — the extraction challenge</SectionTitle>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Services itemised on every page; the extraction agent must capture ALL lines from ALL pages and reconcile
          any per-page subtotals against the stated grand total. One of them is a trap.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className={th}>Invoice</th>
                <th className={th}>Supplier</th>
                <th className={th}>Date</th>
                <th className={thR}>Stated gross</th>
                <th className={`${th} pl-3`}>Pages</th>
                <th className={`${th} pl-3`}>Layout</th>
                <th className={`${th} pl-3`}>Expected outcome</th>
              </tr>
            </thead>
            <tbody>
              {multiPage.map((s) => (
                <tr
                  key={s.chainId}
                  className="border-b align-top last:border-0"
                  style={{
                    borderColor: "var(--border)",
                    background: s.trap ? "color-mix(in srgb, var(--bad) 7%, transparent)" : undefined,
                  }}
                >
                  <td className="py-1.5 pr-3 font-medium tabular-nums whitespace-nowrap">
                    {s.invoiceNumber}
                    {s.trap && <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>TRAP</span>}
                  </td>
                  <td className="py-1.5 pr-3">{s.supplier}</td>
                  <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{formatDate(s.invoiceDate)}</td>
                  <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{money(s.grossMinor)}</td>
                  <td className="py-1.5 pl-3 tabular-nums">{s.pages}</td>
                  <td className="py-1.5 pl-3" style={{ color: "var(--muted)" }}>{s.layout}</td>
                  <td className="py-1.5 pl-3" style={{ color: s.trap ? "var(--bad)" : "var(--muted)" }}>{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionTitle>Poor-quality scans — the vision challenge</SectionTitle>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Rendered with heavy skew, blur, noise and washed-out contrast. The honest outcome for an unreadable figure
          is an escalation, never a guess.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className={th}>Invoice</th>
                <th className={th}>Supplier</th>
                <th className={th}>Date</th>
                <th className={thR}>Gross</th>
              </tr>
            </thead>
            <tbody>
              {poorScans.map((s) => (
                <tr key={s.chainId} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5 pr-3 font-medium tabular-nums whitespace-nowrap">{s.invoiceNumber}</td>
                  <td className="py-1.5 pr-3">{s.supplier}</td>
                  <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{formatDate(s.invoiceDate)}</td>
                  <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{money(s.grossMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* planted exceptions, by code */}
      {codes.map((code) => {
        const rows = d.plants.filter((p) => p.code === code);
        const fraud = rows[0]!.fraud;
        return (
          <Card key={code}>
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle>
                {CODE_LABELS[code] ?? code} — {rows.length}
              </SectionTitle>
              {fraud && fraudBadge}
            </div>
            <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
              {WHAT_IT_SIMULATES[code] ?? ""}. <span className="font-medium" style={{ color: "var(--foreground)" }}>Caught by:</span>{" "}
              {rows[0]!.control}. Watch at{" "}
              <Link href="/p2p/exceptions" className="hover:underline" style={{ color: "var(--accent)" }}>
                /p2p/exceptions
              </Link>
              .
            </p>
            {rowsTable(rows)}
          </Card>
        );
      })}

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Also worth knowing (not planted flaws): the bank feed carries non-settlement lines (salaries, VAT, fees) the
        Reconciliation Agent must classify; the AR side is clean by design — collections exercise timing, not fraud;
        eval runs write to the test book (D16) and never appear in these figures.
      </p>
    </main>
  );
}
