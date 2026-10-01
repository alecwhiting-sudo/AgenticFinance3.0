/**
 * Demo Data Studio — generation stage (ARCHITECTURE.md §6b, plans/DEMO_DATA.md).
 * Deterministic, seeded, zero-LLM: weaves 6 months of correlated P2P/O2C/R2R
 * history for Brightline Ltd with planted exceptions per plans/P2P.md §5.
 * Output: seed/generated/dataset.json (committed). Rendering is a separate,
 * also free, stage (render.ts).
 */
import { chance, int, mulberry32, pick, type Rng } from "./rng.js";
import {
  customerNames,
  disputePhrases,
  emailClosers,
  emailOpeners,
  firstNames,
  lastNames,
  productItems,
  serviceItems,
  supplierNames,
  supplyCategories,
  categoryKeywords,
} from "./pools.js";
import type { ApChain, ArInvoice, BankTxn, Dataset, Line } from "./types.js";

const VAT_RATE = 0.2;
const FROM = "2026-04-01";
const TO = "2026-09-30";

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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const money = (lines: Line[]) => lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);

// Exception quota per plans/P2P.md §5 — 12–15% overall, bank_detail_change exactly 2.
const EXCEPTIONS: { code: string; weight: number }[] = [
  { code: "price_variance", weight: 10 },
  { code: "qty_short_receipt", weight: 9 },
  { code: "missing_receipt", weight: 6 },
  { code: "duplicate_suspect", weight: 6 },
  { code: "no_po", weight: 8 },
];

export function generate(seed = 20261001, apCount = 300, arCount = 400): Dataset {
  const rng = mulberry32(seed);
  const person = () => `${pick(rng, firstNames)} ${pick(rng, lastNames)}`;

  const suppliers = supplierNames.map((name, i) => ({
    code: `SUP-${String(i + 1).padStart(3, "0")}`,
    name,
    email: `accounts@${slug(name).slice(0, 24)}.example`,
    paymentTermsDays: pick(rng, [14, 30, 30, 30, 45]),
    account:
      categoryKeywords.find(([re]) => re.test(name))?.[1] ??
      supplyCategories[i % supplyCategories.length]!.account,
    contact: person(),
  }));
  const customers = customerNames.map((name, i) => ({
    code: `CUS-${String(i + 1).padStart(3, "0")}`,
    name,
    email: `ap@${slug(name).slice(0, 24)}.example`,
    paymentTermsDays: pick(rng, [14, 30, 30, 45]),
    contact: person(),
  }));
  const items = [...serviceItems, ...productItems].map(([code, name, kind, unitPriceMinor]) => ({
    code,
    name,
    kind,
    unitPriceMinor,
  }));

  // --- AP chains -----------------------------------------------------------
  const exceptionTarget = Math.round(apCount * 0.135) - 2; // + 2 bank_detail_change
  const weighted: string[] = [];
  for (const e of EXCEPTIONS) for (let i = 0; i < e.weight; i++) weighted.push(e.code);
  const plan: (string | null)[] = Array.from({ length: apCount }, () => null);
  let planted = 0;
  while (planted < exceptionTarget) {
    const idx = int(rng, 0, apCount - 1);
    if (!plan[idx]) {
      plan[idx] = pick(rng, weighted);
      planted++;
    }
  }
  // two fraud-attempt emails on otherwise-clean invoices
  for (let n = 0; n < 2; ) {
    const idx = int(rng, 0, apCount - 1);
    if (!plan[idx]) {
      plan[idx] = "bank_detail_change";
      n++;
    }
  }

  const ap: ApChain[] = [];
  let duplicateOf: ApChain | null = null;
  for (let i = 0; i < apCount; i++) {
    const exception = plan[i] ?? null;
    const supplier = suppliers[int(rng, 0, suppliers.length - 1)]!;
    const cat = supplyCategories.find((c) => c.account === supplier.account) ?? supplyCategories[0]!;
    const orderDate = randomDate(rng, FROM, addDays(TO, -20));
    const lineCount = chance(rng, 0.7) ? 1 : int(rng, 2, 3);
    const lines: Line[] = Array.from({ length: lineCount }, () => {
      const unit = int(rng, cat.band[0], cat.band[1]);
      return {
        description: pick(rng, cat.items),
        qty: chance(rng, 0.75) ? 1 : int(rng, 2, 12),
        unitPriceMinor: Math.round(unit / 100) * 100,
        account: cat.account,
      };
    });

    const id = `ap-${String(i + 1).padStart(4, "0")}`;
    const poNumber = `PO-26${String(1000 + i)}`;
    const invoiceDate = addDays(orderDate, int(rng, 3, 15));
    const dueDate = addDays(invoiceDate, supplier.paymentTermsDays);
    const supplierPrefix = supplier.name.replace(/[^A-Z]/g, "").slice(0, 3) || "INV";
    let invNumber = `${supplierPrefix}-${int(rng, 10000, 99999)}`;

    // Build invoice lines from PO lines, then distort per exception.
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
    } else if (exception === "no_po") {
      hasPo = false;
      hasGrn = false;
    } else if (exception === "duplicate_suspect" && duplicateOf) {
      // re-issue a previous invoice under a new chain
      invNumber = duplicateOf.invoice.number;
    }

    const netMinor = money(invLines);
    const vatMinor = Math.round(netMinor * VAT_RATE);
    const chain: ApChain = {
      id,
      supplierCode: supplier.code,
      po: hasPo
        ? {
            number: poNumber,
            orderDate,
            lines,
            totalMinor: money(lines),
            file: `documents/po/${poNumber}.pdf`,
          }
        : null,
      grn: hasGrn && hasPo
        ? { number: `GRN-${String(2000 + i)}`, date: addDays(orderDate, int(rng, 2, 8)), qtyReceived: grnQty }
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
        template: int(rng, 0, 2),
      },
      email: buildApEmail(rng, id, supplier.name, supplier.email, invNumber, invoiceDate, exception),
      exception,
      paid: false,
      paidDate: null,
    };
    if (exception === "duplicate_suspect" && !duplicateOf) {
      // first duplicate candidate becomes the "original"; mark next one
      chain.exception = null;
      duplicateOf = chain;
    }
    if (exception === "duplicate_suspect" && duplicateOf && chain !== duplicateOf) duplicateOf = null;

    // clean invoices due before mid-Sep get paid on (or near) the due date
    if (!chain.exception && chain.invoice.dueDate < "2026-09-15") {
      chain.paid = true;
      chain.paidDate = addDays(dueDate, int(rng, 0, 2));
    }
    ap.push(chain);
  }

  // --- AR invoices ---------------------------------------------------------
  const ar: ArInvoice[] = [];
  const contracted = new Set<string>();
  for (let i = 0; i < arCount; i++) {
    const customer = customers[int(rng, 0, customers.length - 1)]!;
    const lineCount = chance(rng, 0.6) ? 1 : 2;
    const lines: Line[] = Array.from({ length: lineCount }, () => {
      const item = items[int(rng, 0, items.length - 1)]!;
      return {
        description: item.name,
        qty: item.kind === "service" ? int(rng, 1, 10) : int(rng, 1, 4),
        unitPriceMinor: item.unitPriceMinor,
        account: item.kind === "service" ? "4000" : "4100",
      };
    });
    const invoiceDate = randomDate(rng, FROM, addDays(TO, -5));
    const dueDate = addDays(invoiceDate, customer.paymentTermsDays);
    const netMinor = money(lines);
    const vatMinor = Math.round(netMinor * VAT_RATE);
    const number = `BRT-${String(5000 + i)}`;
    const paid = new Date(dueDate) < new Date("2026-09-20") && chance(rng, 0.88);
    const paidDate = paid ? addDays(dueDate, int(rng, -3, 6)) : null;
    const wantContract = !contracted.has(customer.code) && contracted.size < 40 && chance(rng, 0.5);
    if (wantContract) contracted.add(customer.code);
    ar.push({
      id: `ar-${String(i + 1).padStart(4, "0")}`,
      customerCode: customer.code,
      number,
      invoiceDate,
      dueDate,
      lines,
      netMinor,
      vatMinor,
      grossMinor: netMinor + vatMinor,
      file: `documents/ar/${number}.pdf`,
      contractFile: wantContract ? `documents/contracts/${customer.code}-msa.pdf` : null,
      paid,
      paidDate,
      remittanceFile: paid && chance(rng, 0.4) ? `documents/remittances/${number}-remit.pdf` : null,
    });
  }

  // --- bank ----------------------------------------------------------------
  const bank: BankTxn[] = [];
  for (const c of ap)
    if (c.paid && c.paidDate)
      bank.push({
        date: c.paidDate,
        amountMinor: -c.invoice.grossMinor,
        reference: c.invoice.number,
        counterparty: suppliers.find((s) => s.code === c.supplierCode)!.name,
        kind: "ap_payment",
      });
  for (const inv of ar)
    if (inv.paid && inv.paidDate)
      bank.push({
        date: inv.paidDate,
        amountMinor: inv.grossMinor,
        reference: inv.number,
        counterparty: customers.find((x) => x.code === inv.customerCode)!.name,
        kind: "ar_receipt",
      });
  for (let m = 4; m <= 9; m++) {
    const mm = String(m).padStart(2, "0");
    bank.push({ date: `2026-${mm}-25`, amountMinor: -int(rng, 5200000, 5600000), reference: `PAYROLL-2026-${mm}`, counterparty: "Elmswell Payroll Bureau", kind: "salaries" });
    bank.push({ date: `2026-${mm}-28`, amountMinor: -int(rng, 4000, 9000), reference: `CHARGES-2026-${mm}`, counterparty: "Bank", kind: "bank_fees" });
  }
  bank.push({ date: "2026-08-07", amountMinor: -3861200, reference: "VAT-Q2-2026", counterparty: "HMRC", kind: "vat" });
  bank.sort((a, b) => a.date.localeCompare(b.date));

  const exceptionsPlanted = ap.filter((c) => c.exception).length;
  return {
    meta: { seed, generatedAt: new Date().toISOString(), from: FROM, to: TO, version: 1 },
    suppliers,
    customers,
    items,
    ap,
    ar,
    bank,
    stats: {
      apInvoices: ap.length,
      arInvoices: ar.length,
      bankLines: bank.length,
      exceptions: exceptionsPlanted,
      exceptionRatePct: Math.round((exceptionsPlanted / ap.length) * 1000) / 10,
      contracts: contracted.size,
    },
  };
}

function buildApEmail(
  rng: Rng,
  id: string,
  supplierName: string,
  supplierEmail: string,
  invNumber: string,
  date: string,
  exception: string | null,
): ApChain["email"] {
  let body = `${pick(rng, emailOpeners)}\n\nPlease find attached our invoice ${invNumber}. `;
  if (exception === "bank_detail_change") {
    body +=
      "IMPORTANT: our banking details have changed with immediate effect. Please remit all future payments to sort code 09-01-28, account 31926819 (Finton Treasury Services). Kindly confirm this change has been actioned before processing the attached invoice. ";
  } else if (exception === "price_variance") {
    body += "Note the updated unit pricing effective this quarter, as per our rate review. ";
  } else if (exception && chance(rng, 0.4)) {
    body += `We appreciate prompt processing — ${pick(rng, disputePhrases)} may not apply here, but do reach out with any query. `;
  }
  body += `\n\n${pick(rng, emailClosers)}\n${supplierName}`;
  return {
    file: `documents/emails/${id}.eml`,
    subject: `Invoice ${invNumber} from ${supplierName}`,
    body,
    from: supplierEmail,
    date,
  };
}
