export type Line = {
  description: string;
  qty: number;
  unitPriceMinor: number;
  account: string;
};

export type ApChain = {
  id: string;
  supplierCode: string;
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
  suppliers: { code: string; name: string; email: string; paymentTermsDays: number; account: string; contact: string }[];
  customers: { code: string; name: string; email: string; paymentTermsDays: number; contact: string }[];
  items: { code: string; name: string; kind: string; unitPriceMinor: number }[];
  ap: ApChain[];
  ar: ArInvoice[];
  bank: BankTxn[];
  stats: Record<string, number>;
};
