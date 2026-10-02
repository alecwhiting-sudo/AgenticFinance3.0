/** Deterministic 3-way match (plans/P2P.md §3): invoice lines vs the APPROVED
 * Purchase's lines vs received quantities. Pure — callers supply the data. */
import type { PurchaseLine } from "@af/db";
import { priceWithinTolerance } from "./policy.js";

export type MatchInput = {
  purchase: { status: string; lines: PurchaseLine[] } | null;
  /** Total received per lineNo across all receipts; null = no receipt recorded. */
  received: Map<number, number> | null;
  invoiceLines: PurchaseLine[];
};

export type MatchResult =
  | { result: "matched" }
  | { result: "exception"; code: string; detail: string };

export function threeWayMatch(input: MatchInput): MatchResult {
  const { purchase, received, invoiceLines } = input;

  if (!purchase) {
    return { result: "exception", code: "no_purchase", detail: "Invoice has no purchase record" };
  }
  if (purchase.status === "requested" || purchase.status === "rejected" || purchase.status === "cancelled") {
    return {
      result: "exception",
      code: "no_purchase",
      detail: `Purchase is ${purchase.status} — not an approved commitment`,
    };
  }
  if (!received) {
    return { result: "exception", code: "missing_receipt", detail: "No goods receipt recorded for the purchase" };
  }

  // Match invoice lines to purchase lines by order (demo simplification; by
  // lineNo when the invoice carries one).
  for (let i = 0; i < invoiceLines.length; i++) {
    const inv = invoiceLines[i]!;
    const po = purchase.lines[i];
    if (!po) {
      return { result: "exception", code: "price_variance", detail: `Invoice line ${i + 1} has no purchase counterpart` };
    }
    if (!priceWithinTolerance(po.unitPriceMinor, inv.unitPriceMinor)) {
      return {
        result: "exception",
        code: "price_variance",
        detail: `Line ${i + 1} "${inv.description}": invoiced ${inv.unitPriceMinor}p vs approved ${po.unitPriceMinor}p`,
      };
    }
    const rec = received.get(po.lineNo) ?? 0;
    if (inv.qty > rec) {
      return {
        result: "exception",
        code: "qty_short_receipt",
        detail: `Line ${i + 1} "${inv.description}": invoiced qty ${inv.qty} vs received ${rec}`,
      };
    }
  }
  return { result: "matched" };
}

/** Duplicate heuristics (pure part): same supplier+number, or same supplier +
 * same gross within a date window. Caller provides candidate invoices. */
export function isDuplicate(
  candidate: { supplierInvoiceNumber: string; grossMinor: number; invoiceDate: string },
  existing: { supplierInvoiceNumber: string; grossMinor: number; invoiceDate: string }[],
  windowDays = 10,
): { duplicate: boolean; reason?: string } {
  for (const e of existing) {
    if (e.supplierInvoiceNumber === candidate.supplierInvoiceNumber) {
      return { duplicate: true, reason: `same supplier invoice number ${e.supplierInvoiceNumber}` };
    }
    const days =
      Math.abs(new Date(candidate.invoiceDate).getTime() - new Date(e.invoiceDate).getTime()) / 86_400_000;
    if (e.grossMinor === candidate.grossMinor && days <= windowDays) {
      return { duplicate: true, reason: `same amount ${e.grossMinor}p within ${windowDays} days of ${e.supplierInvoiceNumber}` };
    }
  }
  return { duplicate: false };
}
