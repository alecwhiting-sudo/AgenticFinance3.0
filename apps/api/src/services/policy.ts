/** Pure policy rules for the unified Purchase model (plans/P2P.md §0, D12). */
import type { PurchaseLine } from "@af/db";

export const VAT_RATE = 0.2;

export const ACCOUNTS = {
  bank: "1000",
  tradePayables: "2000",
  vatControl: "2200",
} as const;

export type ApprovalBand = "auto" | "standard" | "director";

export const AUTO_BAND_LIMIT_MINOR = 50_000; // £500
export const STANDARD_BAND_LIMIT_MINOR = 500_000; // £5,000

/** Approve-once policy bands. knownSupplier=false forces director review. */
export function approvalBandFor(totalMinor: number, knownSupplier: boolean): ApprovalBand {
  if (!knownSupplier) return "director";
  if (totalMinor <= AUTO_BAND_LIMIT_MINOR) return "auto";
  if (totalMinor <= STANDARD_BAND_LIMIT_MINOR) return "standard";
  return "director";
}

export const lineTotal = (l: PurchaseLine): number => l.qty * l.unitPriceMinor;
export const linesTotal = (lines: PurchaseLine[]): number =>
  lines.reduce((n, l) => n + lineTotal(l), 0);

/** Price tolerance per plans/P2P.md §3: ±1% or ±£5, whichever is LOWER. */
export function priceWithinTolerance(approvedUnitMinor: number, invoicedUnitMinor: number): boolean {
  const tolerance = Math.min(Math.round(approvedUnitMinor * 0.01), 500);
  return Math.abs(invoicedUnitMinor - approvedUnitMinor) <= tolerance;
}
