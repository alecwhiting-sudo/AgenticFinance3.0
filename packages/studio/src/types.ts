export type Line = {
  description: string;
  qty: number;
  unitPriceMinor: number;
  account: string;
};

export type ApChain = {
  id: string;
  supplierCode: string;
  /** Unified Purchase model (plans/P2P.md §0): the ask that became the PO. */
  requisition: {
    requestedBy: string;
    businessNeed: string;
    requestDate: string;
    approvalBand: "auto" | "standard" | "director";
    approvedBy: string;
    approvedAt: string;
  } | null;
  po: { number: string; orderDate: string; lines: Line[]; totalMinor: number; file: string } | null;
  grn: { number: string; date: string; qtyReceived: number[] } | null;
  invoice: {
    number: string;
    invoiceDate: string;
    dueDate: string;
    lines: Line[];
    netMinor: number;
    vatMinor: number;
    grossMinor: number;
    file: string;
    template: number;
    /** Additive format mix (plans/DEMO_DATA.md): how this invoice arrives.
     * Absent/text_pdf = the original rendered PDF with a text layer. */
    format?: "text_pdf" | "scan_pdf" | "ubl_xml";
    /** The alternate-format file (scan PDF or UBL XML); `file` keeps the
     * original text PDF so existing documents stay untouched. */
    altFile?: string;
    /** Dataset v2 (plans/DATASET_V2.md PR-C) ------------------------------ */
    /** The IBAN printed on the invoice. Checked against the supplier
     * master's IBAN at intake — a difference is `bank_detail_mismatch`. */
    iban?: string;
    /** Multi-page services invoice: lines spread over `pages` pages,
     * optionally with per-page subtotals; `trap` = the stated grand total
     * does NOT equal the sum of the lines (must raise `total_mismatch`). */
    multiPage?: { pages: number; perPageSubtotals: boolean; trap?: boolean };
    /** The full plain-text layer of a multi-page invoice — what intake and
     * the extraction agent read in place of the one-line AF-DATA block. */
    textLayer?: string;
    /** Scan tier: "poor" renders with heavier skew/noise/blur. */
    scanQuality?: "poor";
  };
  email: { file: string; subject: string; body: string; from: string; date: string };
  exception: string | null;
  paid: boolean;
  paidDate: string | null;
};

export type ArInvoice = {
  id: string;
  customerCode: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  lines: Line[];
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  file: string;
  contractFile: string | null;
  paid: boolean;
  paidDate: string | null;
  remittanceFile: string | null;
};

export type BankTxn = {
  date: string;
  amountMinor: number; // positive = money in
  reference: string;
  counterparty: string;
  kind: "ap_payment" | "ar_receipt" | "salaries" | "vat" | "bank_fees";
};

export type Dataset = {
  meta: { seed: number; generatedAt: string; from: string; to: string; version: number };
  suppliers: { code: string; name: string; email: string; paymentTermsDays: number; account: string; contact: string; iban?: string }[];
  customers: { code: string; name: string; email: string; paymentTermsDays: number; contact: string }[];
  items: { code: string; name: string; kind: string; unitPriceMinor: number }[];
  ap: ApChain[];
  ar: ArInvoice[];
  bank: BankTxn[];
  stats: Record<string, number>;
};
