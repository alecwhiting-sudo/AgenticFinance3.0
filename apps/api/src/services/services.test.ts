import { describe, expect, it } from "vitest";
import { approvalBandFor, priceWithinTolerance } from "./policy.js";
import { isDuplicate, threeWayMatch } from "./match.js";
import { apInvoiceJournalLines, validateJournalLines } from "./posting.js";
import { bankTxnMatchesPayment, selectDueInvoices } from "./payments.js";
import { parseUblInvoice } from "./ubl.js";
import { validateDeltas } from "./fdpPost.js";
import { deriveDeltas, deriveMonthEndDeltas, periodEnd } from "./fdpEngine.js";
import type { PurchaseLine } from "@af/db";

const line = (over: Partial<PurchaseLine> = {}): PurchaseLine => ({
  lineNo: 1,
  description: "Thing",
  qty: 10,
  unitPriceMinor: 10_000,
  accountCode: "6200",
  ...over,
});

describe("approval bands (approve once, at intent)", () => {
  it("auto band at and under £500 for known suppliers", () => {
    expect(approvalBandFor(50_000, true)).toBe("auto");
    expect(approvalBandFor(49_999, true)).toBe("auto");
  });
  it("standard band to £5,000", () => {
    expect(approvalBandFor(50_001, true)).toBe("standard");
    expect(approvalBandFor(500_000, true)).toBe("standard");
  });
  it("director above £5,000", () => expect(approvalBandFor(500_001, true)).toBe("director"));
  it("new supplier always goes to director, even small spend", () =>
    expect(approvalBandFor(1_000, false)).toBe("director"));
});

describe("price tolerance (±1% or ±£5, whichever lower)", () => {
  it("1% governs under £500 unit price", () => {
    expect(priceWithinTolerance(10_000, 10_100)).toBe(true); // +1% exactly
    expect(priceWithinTolerance(10_000, 10_101)).toBe(false);
  });
  it("£5 cap governs on expensive units", () => {
    expect(priceWithinTolerance(200_000, 200_500)).toBe(true); // +£5
    expect(priceWithinTolerance(200_000, 200_600)).toBe(false); // 1% would allow £20
  });
});

describe("3-way match", () => {
  const approved = { status: "approved", lines: [line()] };
  const fullReceipt = new Map([[1, 10]]);

  it("clean invoice matches", () => {
    expect(threeWayMatch({ purchase: approved, received: fullReceipt, invoiceLines: [line()] })).toEqual({
      result: "matched",
    });
  });
  it("no purchase record", () => {
    const r = threeWayMatch({ purchase: null, received: null, invoiceLines: [line()] });
    expect(r).toMatchObject({ result: "exception", code: "no_purchase" });
  });
  it("unapproved purchase is not a commitment", () => {
    const r = threeWayMatch({
      purchase: { status: "requested", lines: [line()] },
      received: fullReceipt,
      invoiceLines: [line()],
    });
    expect(r).toMatchObject({ result: "exception", code: "no_purchase" });
  });
  it("missing receipt", () => {
    const r = threeWayMatch({ purchase: approved, received: null, invoiceLines: [line()] });
    expect(r).toMatchObject({ result: "exception", code: "missing_receipt" });
  });
  it("price variance beyond tolerance", () => {
    const r = threeWayMatch({
      purchase: approved,
      received: fullReceipt,
      invoiceLines: [line({ unitPriceMinor: 11_000 })],
    });
    expect(r).toMatchObject({ result: "exception", code: "price_variance" });
  });
  it("invoiced 100 received 80", () => {
    const r = threeWayMatch({
      purchase: { status: "approved", lines: [line({ qty: 100 })] },
      received: new Map([[1, 80]]),
      invoiceLines: [line({ qty: 100 })],
    });
    expect(r).toMatchObject({ result: "exception", code: "qty_short_receipt" });
  });
  it("invoicing less than received is fine (part billing)", () => {
    const r = threeWayMatch({
      purchase: { status: "approved", lines: [line({ qty: 10 })] },
      received: fullReceipt,
      invoiceLines: [line({ qty: 8 })],
    });
    expect(r).toEqual({ result: "matched" });
  });
});

describe("duplicate detection", () => {
  const existing = [{ supplierInvoiceNumber: "ABC-1", grossMinor: 12_000, invoiceDate: "2026-05-01" }];
  it("same supplier invoice number", () => {
    expect(
      isDuplicate({ supplierInvoiceNumber: "ABC-1", grossMinor: 99, invoiceDate: "2026-07-01" }, existing).duplicate,
    ).toBe(true);
  });
  it("same amount within window", () => {
    expect(
      isDuplicate({ supplierInvoiceNumber: "ABC-2", grossMinor: 12_000, invoiceDate: "2026-05-08" }, existing).duplicate,
    ).toBe(true);
  });
  it("same amount outside window is fine", () => {
    expect(
      isDuplicate({ supplierInvoiceNumber: "ABC-2", grossMinor: 12_000, invoiceDate: "2026-06-20" }, existing).duplicate,
    ).toBe(false);
  });
});

describe("posting rules", () => {
  it("rejects unbalanced journals", () => {
    expect(
      validateJournalLines([
        { accountCode: "6200", amountMinor: 100 },
        { accountCode: "2000", amountMinor: -99 },
      ]),
    ).toMatch(/balance/);
  });
  it("rejects single-line and zero-amount journals", () => {
    expect(validateJournalLines([{ accountCode: "6200", amountMinor: 100 }])).toBeTruthy();
    expect(
      validateJournalLines([
        { accountCode: "6200", amountMinor: 0 },
        { accountCode: "2000", amountMinor: 0 },
      ]),
    ).toBeTruthy();
  });
  it("AP invoice journal: DR expenses by account, DR VAT, CR payables, balanced", () => {
    const lines = apInvoiceJournalLines({
      lines: [line({ accountCode: "6200", qty: 1, unitPriceMinor: 10_000 }), line({ lineNo: 2, accountCode: "6400", qty: 2, unitPriceMinor: 5_000 })],
      vatMinor: 4_000,
      grossMinor: 24_000,
    });
    expect(lines.reduce((n, l) => n + l.amountMinor, 0)).toBe(0);
    expect(lines.find((l) => l.accountCode === "6200")!.amountMinor).toBe(10_000);
    expect(lines.find((l) => l.accountCode === "6400")!.amountMinor).toBe(10_000);
    expect(lines.find((l) => l.accountCode === "2200")!.amountMinor).toBe(4_000);
    expect(lines.find((l) => l.accountCode === "2000")!.amountMinor).toBe(-24_000);
  });
});

describe("payment scheduler + reconciliation (M4)", () => {
  it("selects only posted invoices due within the horizon", () => {
    const invs = [
      { status: "posted", dueDate: "2026-09-25" },
      { status: "posted", dueDate: "2026-10-05" },
      { status: "posted", dueDate: "2026-11-01" },
      { status: "exception", dueDate: "2026-09-25" },
      { status: "paid", dueDate: "2026-09-25" },
    ];
    const due = selectDueInvoices(invs, "2026-10-01", 7);
    expect(due.map((i) => i.dueDate)).toEqual(["2026-09-25", "2026-10-05"]);
  });
  it("matches a bank line to a run by reference and amount", () => {
    const pay = { paymentRef: "RUN-2026-10-01-00042", totalMinor: 123_45 };
    expect(
      bankTxnMatchesPayment({ reference: "RUN-2026-10-01-00042", amountMinor: -123_45, kind: "ap_payment" }, pay),
    ).toBe(true);
    expect(
      bankTxnMatchesPayment({ reference: "RUN-2026-10-01-00042", amountMinor: -123_44, kind: "ap_payment" }, pay),
    ).toBe(false);
    expect(
      bankTxnMatchesPayment({ reference: "RUN-2026-10-01-00042", amountMinor: -123_45, kind: "salaries" }, pay),
    ).toBe(false);
  });
  it("matches the loader's PAY-<invoice> convention", () => {
    expect(
      bankTxnMatchesPayment(
        { reference: "AC-51380", amountMinor: -50_000, kind: "ap_payment" },
        { paymentRef: "PAY-AC-51380", totalMinor: 50_000 },
      ),
    ).toBe(true);
  });
});

describe("UBL e-invoice parser (format mix)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>FMS-91311</cbc:ID>
  <cbc:IssueDate>2026-07-24</cbc:IssueDate>
  <cbc:DueDate>2026-08-23</cbc:DueDate>
  <cac:OrderReference><cbc:ID>PO-261001</cbc:ID></cac:OrderReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID>SUP-011</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Foxglove &amp; Co</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="GBP">47.04</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="GBP">235.20</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="GBP">282.24</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">4</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="GBP">235.20</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Design &amp; print</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="GBP">58.80</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
  it("parses number, dates, PO, supplier and pence amounts", () => {
    const p = parseUblInvoice(xml)!;
    expect(p.number).toBe("FMS-91311");
    expect(p.poNumber).toBe("PO-261001");
    expect(p.supplierCode).toBe("SUP-011");
    expect(p.supplierName).toBe("Foxglove & Co");
    expect(p.netMinor).toBe(23520);
    expect(p.vatMinor).toBe(4704);
    expect(p.grossMinor).toBe(28224);
    expect(p.lines).toEqual([{ description: "Design & print", qty: 4, unitPriceMinor: 5880 }]);
  });
  it("refuses non-UBL and incomplete documents", () => {
    expect(parseUblInvoice("<html>not an invoice</html>")).toBeNull();
    expect(parseUblInvoice(xml.replace("<cbc:DueDate>2026-08-23</cbc:DueDate>", ""))).toBeNull();
  });
});

describe("FDP posting pipeline (D13)", () => {
  it("accepts balanced account-coded deltas", () => {
    expect(validateDeltas([
      { accountCode: "6200", amountMinor: 10_000 },
      { accountCode: "2000", amountMinor: -10_000 },
    ])).toBeNull();
  });
  it("rejects unbalanced, zero, single and badly coded deltas", () => {
    expect(validateDeltas([
      { accountCode: "6200", amountMinor: 10_000 },
      { accountCode: "2000", amountMinor: -9_999 },
    ])).toMatch(/balance/);
    expect(validateDeltas([
      { accountCode: "6200", amountMinor: 0 },
      { accountCode: "2000", amountMinor: 0 },
    ])).toMatch(/zero/);
    expect(validateDeltas([{ accountCode: "6200", amountMinor: 5 }])).toMatch(/two deltas/);
    expect(validateDeltas([
      { accountCode: "62", amountMinor: 5 },
      { accountCode: "2000", amountMinor: -5 },
    ])).toMatch(/account code/);
  });
});

describe("month-end derivation engine (R2R M2)", () => {
  const sched = { key: "prepay-insurance", kind: "prepayment_release" as const, description: "Annual insurance released monthly", accountDr: "6100", accountCr: "1500", amountMinor: 24900 };
  it("derives a balanced DR/CR pair from a schedule", () => {
    const d = deriveMonthEndDeltas(sched);
    expect(d).toEqual([
      { accountCode: "6100", amountMinor: 24900, memo: "Annual insurance released monthly" },
      { accountCode: "1500", amountMinor: -24900, memo: "Annual insurance released monthly" },
    ]);
  });
  it("reversal negates both sides", () => {
    const d = deriveMonthEndDeltas(sched, true);
    expect(d[0]!.amountMinor).toBe(-24900);
    expect(d[1]!.amountMinor).toBe(24900);
    expect(d[0]!.memo).toMatch(/Reversal/);
  });
  it("deriveDeltas routes period.tick and rejects unknown types", () => {
    expect(deriveDeltas("period.tick", { schedule: sched }).length).toBe(2);
    expect(() => deriveDeltas("period.tick", {})).toThrow(/schedule/);
    expect(() => deriveDeltas("mystery.event", {})).toThrow(/no derivation engine/);
  });
  it("periodEnd handles month lengths and leap years", () => {
    expect(periodEnd("2026-07")).toBe("2026-07-31");
    expect(periodEnd("2026-09")).toBe("2026-09-30");
    expect(periodEnd("2028-02")).toBe("2028-02-29");
  });
});
