/**
 * Dataset v2 extension (plans/DATASET_V2.md PR-C): runs AFTER generate() and
 * only APPENDS — Jan–Mar 2026 chains, supplier IBANs, and the planted
 * edge-case documents. Every random draw comes from streams independent of
 * the v1 stream, so the v1 months regenerate byte-identical forever.
 *
 * Planted here (documented in docs/plans/TEST_DATA_MAP.md):
 *  - 5 multi-page services invoices: 2 with per-page subtotals + grand
 *    total, 2 with the grand total only on the last page, 1 TRAP whose
 *    stated grand total does NOT equal the sum of its lines
 *    (`total_mismatch` — must be raised, never silently posted);
 *  - 5 invoices whose printed IBAN differs from the supplier master
 *    (`bank_detail_mismatch` — held for humans, like the C-P4 screen);
 *  - ~10 scan invoices rendered at a deliberately poor quality tier;
 *  - the ordinary exception taxonomy pro-rata, incl. 1 more fraud email.
 */
import { chance, int, mulberry32, pick, type Rng } from "./rng.js";
import { firstNames, lastNames, supplyCategories } from "./pools.js";
import { buildApEmail } from "./generate.js";
import type { ApChain, ArInvoice, BankTxn, Dataset, Line } from "./types.js";

const VAT_RATE = 0.2;
const V2_FROM = "2026-01-01";
const V2_TO = "2026-03-31";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};
const randomDate = (rng: Rng, from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return iso(new Date(a + rng() * (b - a)));
};
const money = (lines: Line[]) => lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
const gbp = (minor: number) => `£${(minor / 100).toFixed(2)}`;

/** Plausible (fake) GB IBAN — deterministic from the stream. */
const fakeIban = (rng: Rng) =>
  `GB${int(rng, 10, 98)}BARC${int(rng, 100000, 999999)}${int(rng, 10000000, 99999999)}`;

/** Local index (0-based within the extension) → multi-page spec. */
const MULTI_PAGE: Record<number, { pages: number; perPageSubtotals: boolean; trap?: boolean }> = {
  10: { pages: 2, perPageSubtotals: true },
  40: { pages: 3, perPageSubtotals: true },
  70: { pages: 2, perPageSubtotals: false },
  100: { pages: 4, perPageSubtotals: false },
  130: { pages: 3, perPageSubtotals: true, trap: true },
};
const IBAN_MISMATCH = new Set([20, 50, 80, 110, 140]);

const EXCEPTIONS: { code: string; weight: number }[] = [
  { code: "price_variance", weight: 10 },
  { code: "qty_short_receipt", weight: 9 },
  { code: "missing_receipt", weight: 6 },
  { code: "duplicate_suspect", weight: 6 },
  { code: "no_purchase", weight: 8 },
];

/** The plain-text layer of a multi-page invoice: what a PDF text extraction
 * would see, page by page. Deliberately NOT an AF-DATA block — the model
 * must read pages, sum lines and reconcile the stated total itself. */
export function multiPageTextLayer(chain: ApChain, supplierName: string): string {
  const inv = chain.invoice;
  const mp = inv.multiPage!;
  const per = Math.ceil(inv.lines.length / mp.pages);
  const parts: string[] = [];
  for (let p = 0; p < mp.pages; p++) {
    const pageLines = inv.lines.slice(p * per, (p + 1) * per);
    const sub = money(pageLines);
    parts.push(
      [
        `===== PAGE ${p + 1} OF ${mp.pages} =====`,
        `${supplierName} — TAX INVOICE ${inv.number}`,
        `Invoice date ${inv.invoiceDate} · Payment due ${inv.dueDate}${chain.po ? ` · Your PO ${chain.po.number}` : ""}`,
        `Bill to: Brightline Services plc, 14 Foundry Lane, Leeds LS1 4DQ`,
        ``,
        ...pageLines.map(
          (l) => `  ${l.description}  x${l.qty} @ ${gbp(l.unitPriceMinor)}  =  ${gbp(l.qty * l.unitPriceMinor)}`,
        ),
        ...(mp.perPageSubtotals ? [``, `  Subtotal this page: ${gbp(sub)}`] : []),
        ...(p === mp.pages - 1
          ? [
              ``,
              `  TOTAL NET: ${gbp(inv.netMinor)}`,
              `  VAT 20%: ${gbp(inv.vatMinor)}`,
              `  TOTAL DUE: ${gbp(inv.grossMinor)}`,
              ...(inv.iban ? [`  Pay by bank transfer to IBAN ${inv.iban}`] : []),
            ]
          : [`  (continued on page ${p + 2})`]),
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

export function extendV2(ds: Dataset, seed = 20261001, apCount = 150, arCount = 200): Dataset {
  const rng = mulberry32(seed ^ 0x51f2a3c7);
  const rngReq = mulberry32(seed ^ 0x2c611f0d);

  // supplier master IBANs (additive field; its own stream, supplier order)
  const rngIban = mulberry32(seed ^ 0x1ba9);
  for (const s of ds.suppliers) s.iban = fakeIban(rngIban);
  const supplierByCode = new Map(ds.suppliers.map((s) => [s.code, s]));

  // --- exception plan: ordinary taxonomy around the fixed special slots ----
  const weighted: string[] = [];
  for (const e of EXCEPTIONS) for (let i = 0; i < e.weight; i++) weighted.push(e.code);
  const special = (i: number) => MULTI_PAGE[i] !== undefined || IBAN_MISMATCH.has(i);
  const plan: (string | null)[] = Array.from({ length: apCount }, () => null);
  const ordinaryTarget = 13;
  let planted = 0;
  while (planted < ordinaryTarget) {
    const idx = int(rng, 0, apCount - 1);
    if (!plan[idx] && !special(idx)) {
      plan[idx] = pick(rng, weighted);
      planted++;
    }
  }
  for (let n = 0; n < 1; ) {
    const idx = int(rng, 0, apCount - 1);
    if (!plan[idx] && !special(idx)) {
      plan[idx] = "bank_detail_change";
      n++;
    }
  }

  // --- AP chains ------------------------------------------------------------
  const ap: ApChain[] = [];
  let duplicateOf: ApChain | null = null;
  for (let i = 0; i < apCount; i++) {
    const mp = MULTI_PAGE[i];
    const ibanMismatch = IBAN_MISMATCH.has(i);
    const exception = mp?.trap ? "total_mismatch" : ibanMismatch ? "bank_detail_mismatch" : (plan[i] ?? null);
    const supplier = ds.suppliers[int(rng, 0, ds.suppliers.length - 1)]!;
    const cat = supplyCategories.find((c) => c.account === supplier.account) ?? supplyCategories[0]!;
    const orderDate = randomDate(rng, V2_FROM, addDays(V2_TO, -20));
    const lineCount = mp ? int(rng, 8, 12) : chance(rng, 0.7) ? 1 : int(rng, 2, 3);
    const lines: Line[] = Array.from({ length: lineCount }, () => {
      const unit = int(rng, cat.band[0], cat.band[1]);
      return {
        description: pick(rng, cat.items),
        qty: chance(rng, 0.75) ? 1 : int(rng, 2, mp ? 6 : 12),
        unitPriceMinor: Math.round(unit / 100) * 100,
        account: cat.account,
      };
    });

    const seq = 300 + i; // continues v1 numbering
    const id = `ap-${String(seq + 1).padStart(4, "0")}`;
    const poNumber = `PO-26${String(1300 + i)}`;
    const invoiceDate = addDays(orderDate, int(rng, 3, 15));
    const dueDate = addDays(invoiceDate, supplier.paymentTermsDays);
    const supplierPrefix = supplier.name.replace(/[^A-Z]/g, "").slice(0, 3) || "INV";
    const invNumber = `${supplierPrefix}-${int(rng, 10000, 99999)}`;

    const invLines: Line[] = lines.map((l) => ({ ...l }));
    let grnQty = lines.map((l) => l.qty);
    let hasPo = true;
    let hasGrn = true;

    if (exception === "price_variance") {
      const l = invLines[0]!;
      l.unitPriceMinor = Math.round((l.unitPriceMinor * (1 + 0.04 + rng() * 0.1)) / 100) * 100;
    } else if (exception === "qty_short_receipt") {
      const l = lines[0]!;
      if (l.qty < 3) l.qty = int(rng, 4, 10);
      invLines[0]!.qty = l.qty;
      grnQty = lines.map((l2, j) => (j === 0 ? Math.max(1, Math.floor(l2.qty * 0.8)) : l2.qty));
    } else if (exception === "missing_receipt") {
      hasGrn = false;
    } else if (exception === "no_purchase") {
      hasPo = false;
      hasGrn = false;
    }

    const linesSum = money(invLines);
    // the TRAP: the document STATES a grand total that is NOT the line sum
    // (a classic carried-subtotal error). Stored totals = what the document
    // says, so extraction that "fixes" it silently is also wrong — the
    // intake totals check must raise total_mismatch.
    const netMinor = mp?.trap ? linesSum + 90000 : linesSum;
    const vatMinor = Math.round(netMinor * VAT_RATE);
    const poTotal = money(lines);
    const approvalBand = !hasPo ? null : poTotal <= 50000 ? "auto" : poTotal <= 500000 ? "standard" : "director";
    const requester = `${pick(rngReq, firstNames)} ${pick(rngReq, lastNames)}`;
    const requestDate = addDays(orderDate, -int(rngReq, 1, 5));
    const chain: ApChain = {
      id,
      supplierCode: supplier.code,
      requisition: hasPo
        ? {
            requestedBy: requester,
            businessNeed: `${pick(rngReq, ["Team", "Client project", "Office", "Quarterly", "Replacement", "New starter"])} need: ${lines[0]!.description.toLowerCase()}`,
            requestDate,
            approvalBand: approvalBand!,
            approvedBy:
              approvalBand === "auto"
                ? "standing-authority (auto band)"
                : approvalBand === "standard"
                  ? `${pick(rngReq, firstNames)} ${pick(rngReq, lastNames)} (manager)`
                  : "Finance Director",
            approvedAt: addDays(requestDate, approvalBand === "auto" ? 0 : int(rngReq, 0, 2)),
          }
        : null,
      po: hasPo
        ? { number: poNumber, orderDate, lines, totalMinor: poTotal, file: `documents/po/${poNumber}.pdf` }
        : null,
      grn:
        hasGrn && hasPo
          ? { number: `GRN-${String(2300 + i)}`, date: addDays(orderDate, int(rng, 2, 8)), qtyReceived: grnQty }
          : null,
      invoice: {
        number: invNumber,
        invoiceDate,
        dueDate,
        lines: invLines,
        netMinor,
        vatMinor,
        grossMinor: netMinor + vatMinor,
        file: `documents/ap/${id}-${invNumber}.pdf`,
        template: mp ? 3 : int(rng, 0, 2),
        // every v2 invoice prints an IBAN; the mismatch set prints a WRONG one
        iban: ibanMismatch ? fakeIban(rng) : supplier.iban,
        ...(mp ? { multiPage: mp } : {}),
      },
      // the covering email gives nothing away on the planted document flaws
      email: buildApEmail(
        rng, id, supplier.name, supplier.email, invNumber, invoiceDate,
        mp || ibanMismatch ? null : exception,
      ),
      exception,
      paid: false,
      paidDate: null,
    };
    if (mp) chain.invoice.textLayer = multiPageTextLayer(chain, supplier.name);

    if (exception === "duplicate_suspect" && !duplicateOf) {
      chain.exception = null;
      duplicateOf = chain;
    } else if (exception === "duplicate_suspect" && duplicateOf) {
      const orig = duplicateOf;
      chain.supplierCode = orig.supplierCode;
      chain.invoice.lines = orig.invoice.lines.map((l) => ({ ...l }));
      chain.invoice.netMinor = orig.invoice.netMinor;
      chain.invoice.vatMinor = orig.invoice.vatMinor;
      chain.invoice.grossMinor = orig.invoice.grossMinor;
      chain.invoice.invoiceDate = addDays(orig.invoice.invoiceDate, int(rngReq, 2, 8));
      chain.invoice.dueDate = addDays(chain.invoice.invoiceDate, 30);
      const origPrefix = orig.invoice.number.split("-")[0]!;
      chain.invoice.number = `${origPrefix}-${int(rngReq, 10000, 99999)}`;
      chain.invoice.file = `documents/ap/${chain.id}-${chain.invoice.number}.pdf`;
      chain.invoice.iban = supplierByCode.get(orig.supplierCode)!.iban;
      const origSupplier = supplierByCode.get(orig.supplierCode)!;
      chain.email = buildApEmail(
        rngReq, chain.id, origSupplier.name, origSupplier.email,
        chain.invoice.number, chain.invoice.invoiceDate, "duplicate_suspect",
      );
      chain.email.subject = `Invoice ${chain.invoice.number} (resend)`;
      duplicateOf = null;
    }

    if (!chain.exception && chain.invoice.dueDate < "2026-09-15") {
      chain.paid = true;
      chain.paidDate = addDays(chain.invoice.dueDate, int(rng, 0, 2));
    }
    ap.push(chain);
  }

  // --- AR invoices ------------------------------------------------------------
  const ar: ArInvoice[] = [];
  for (let i = 0; i < arCount; i++) {
    const customer = ds.customers[int(rng, 0, ds.customers.length - 1)]!;
    const lineCount = chance(rng, 0.6) ? 1 : 2;
    const lines: Line[] = Array.from({ length: lineCount }, () => {
      const item = ds.items[int(rng, 0, ds.items.length - 1)]!;
      return {
        description: item.name,
        qty: item.kind === "service" ? int(rng, 1, 10) : int(rng, 1, 4),
        unitPriceMinor: item.unitPriceMinor,
        account: item.kind === "service" ? "4000" : "4100",
      };
    });
    const invoiceDate = randomDate(rng, V2_FROM, addDays(V2_TO, -5));
    const dueDate = addDays(invoiceDate, customer.paymentTermsDays);
    const netMinor = money(lines);
    const vatMinor = Math.round(netMinor * VAT_RATE);
    const number = `BRT-${String(5400 + i)}`;
    const paid = chance(rng, 0.88);
    const paidDate = paid ? addDays(dueDate, int(rng, -3, 6)) : null;
    ar.push({
      id: `ar-${String(400 + i + 1).padStart(4, "0")}`,
      customerCode: customer.code,
      number,
      invoiceDate,
      dueDate,
      lines,
      netMinor,
      vatMinor,
      grossMinor: netMinor + vatMinor,
      file: `documents/ar/${number}.pdf`,
      contractFile: null,
      paid,
      paidDate,
      remittanceFile: paid && chance(rng, 0.4) ? `documents/remittances/${number}-remit.pdf` : null,
    });
  }

  // --- bank -------------------------------------------------------------------
  const bank: BankTxn[] = [];
  for (const c of ap)
    if (c.paid && c.paidDate)
      bank.push({
        date: c.paidDate,
        amountMinor: -c.invoice.grossMinor,
        reference: c.invoice.number,
        counterparty: supplierByCode.get(c.supplierCode)!.name,
        kind: "ap_payment",
      });
  const customerByCode = new Map(ds.customers.map((c) => [c.code, c]));
  for (const inv of ar)
    if (inv.paid && inv.paidDate)
      bank.push({
        date: inv.paidDate,
        amountMinor: inv.grossMinor,
        reference: inv.number,
        counterparty: customerByCode.get(inv.customerCode)!.name,
        kind: "ar_receipt",
      });
  for (let m = 1; m <= 3; m++) {
    const mm = String(m).padStart(2, "0");
    bank.push({ date: `2026-${mm}-25`, amountMinor: -int(rng, 5200000, 5600000), reference: `PAYROLL-2026-${mm}`, counterparty: "Elmswell Payroll Bureau", kind: "salaries" });
    bank.push({ date: `2026-${mm}-28`, amountMinor: -int(rng, 4000, 9000), reference: `CHARGES-2026-${mm}`, counterparty: "Bank", kind: "bank_fees" });
  }
  bank.push({ date: "2026-05-07", amountMinor: -3412800, reference: "VAT-Q1-2026", counterparty: "HMRC", kind: "vat" });

  // --- merge (append + resort; v1 rows themselves never change) ---------------
  ds.ap.push(...ap);
  ds.ar.push(...ar);
  ds.bank.push(...bank);
  ds.bank.sort((a, b) => a.date.localeCompare(b.date));

  ds.meta.from = V2_FROM;
  ds.meta.version = 2;
  const exceptionsPlanted = ds.ap.filter((c) => c.exception).length;
  ds.stats = {
    apInvoices: ds.ap.length,
    arInvoices: ds.ar.length,
    bankLines: ds.bank.length,
    exceptions: exceptionsPlanted,
    exceptionRatePct: Math.round((exceptionsPlanted / ds.ap.length) * 1000) / 10,
    contracts: ds.stats.contracts ?? 0,
    multiPage: Object.keys(MULTI_PAGE).length,
    ibanMismatch: IBAN_MISMATCH.size,
  };
  return ds;
}
