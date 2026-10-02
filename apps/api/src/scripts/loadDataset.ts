/**
 * Load the Demo Data Studio dataset into the ERP through the SAME
 * deterministic intake services the runtime uses (plans/P2P.md M1):
 * purchases (approved, banded, budget-committed) → receipts → invoices →
 * 3-way match re-derives each outcome → clean ones post + pay (journals),
 * exceptions become evidence cases → bank feed loaded and payments matched.
 *
 * The match service re-deriving the Studio's planted exception codes is a
 * built-in cross-check: any disagreement is reported at the end.
 *
 * Usage: tsx src/scripts/loadDataset.ts [--reset]   (needs DATABASE_URL)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import {
  seedCore,
  apInvoice,
  apPayment,
  bankTransaction,
  caseEvent,
  categoryBudget,
  createDb,
  evidenceCase,
  goodsReceipt,
  purchase,
  type PurchaseLine,
} from "@af/db";
import { threeWayMatch, isDuplicate } from "../services/match.js";
import { parseUblInvoice } from "../services/ubl.js";
import {
  commitPurchaseBudget,
  executeApPayment,
  markPurchaseReceived,
  postApInvoice,
} from "../services/posting.js";

const seedDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/seed",
);

type StudioLine = { description: string; qty: number; unitPriceMinor: number; account: string };
type StudioChain = {
  id: string;
  supplierCode: string;
  requisition: {
    requestedBy: string;
    businessNeed: string;
    requestDate: string;
    approvalBand: "auto" | "standard" | "director";
    approvedBy: string;
    approvedAt: string;
  } | null;
  po: { number: string; orderDate: string; lines: StudioLine[]; totalMinor: number; file: string } | null;
  grn: { number: string; date: string; qtyReceived: number[] } | null;
  invoice: {
    number: string; invoiceDate: string; dueDate: string; lines: StudioLine[];
    netMinor: number; vatMinor: number; grossMinor: number; file: string;
    format?: "text_pdf" | "scan_pdf" | "ubl_xml"; altFile?: string;
  };
  email: { file: string; body: string };
  exception: string | null;
  paid: boolean;
  paidDate: string | null;
};
type StudioDataset = {
  ap: StudioChain[];
  bank: { date: string; amountMinor: number; reference: string; counterparty: string; kind: string }[];
};

const toLines = (ls: StudioLine[]): PurchaseLine[] =>
  ls.map((l, i) => ({ lineNo: i + 1, description: l.description, qty: l.qty, unitPriceMinor: l.unitPriceMinor, accountCode: l.account }));

/** Fraud screen: untrusted email text asking to change bank details. */
const looksLikeBankDetailChange = (body: string): boolean =>
  /\b(sort\s*code|bank(ing)?\s+details?|account\s+number|remit.*to)\b/i.test(body) &&
  /\bchang|new account|immediate effect|updated bank/i.test(body);

// Demo monthly budgets per expense account (pence) for commitment tracking.
const MONTHLY_BUDGETS: Record<string, number> = {
  "5000": 2_500_000, "6000": 5_600_000, "6100": 1_200_000, "6200": 900_000,
  "6300": 400_000, "6400": 900_000, "6500": 900_000, "6900": 300_000,
};

const dataset: StudioDataset = JSON.parse(readFileSync(path.join(seedDir, "generated/dataset.json"), "utf8"));
const { db, pool } = createDb();
const reset = process.argv.includes("--reset");

// Core seed is a hard prerequisite (company, periods, accounts, agents).
// Run it ourselves — idempotent — instead of trusting the pre-deploy step.
await seedCore(db);
const companyRow = await db.query.company.findFirst();
if (!companyRow) {
  console.error("core seed did not produce a company row — aborting P2P load");
  await pool.end();
  process.exit(1);
}

const existing = await db.select({ n: sql<number>`count(*)` }).from(purchase);
if (Number(existing[0]!.n) > 0) {
  if (!reset) {
    console.log("P2P data already loaded — pass --reset to reload");
    await pool.end();
    process.exit(0);
  }
  await db.execute(sql`
    truncate table erp.journal_line, erp.journal, erp.bank_transaction, erp.ap_payment,
      erp.ap_invoice, erp.goods_receipt, erp.purchase, erp.category_budget cascade`);
  console.log("P2P tables truncated");
}

// budgets Apr–Mar (12 seeded periods)
const periods = await db.query.fiscalPeriod.findMany();
for (const p of periods)
  for (const [accountCode, budgetMinor] of Object.entries(MONTHLY_BUDGETS))
    await db.insert(categoryBudget).values({ accountCode, periodCode: p.code, budgetMinor }).onConflictDoNothing();

const suppliers = await db.query.supplier.findMany();
const supplierByCode = new Map(suppliers.map((s) => [s.code, s]));

// Studio dataset has 40 suppliers; core seed has 5. Insert any missing ones
// through master data intake (they are master data, not transactions).
{
  const seedData = JSON.parse(readFileSync(path.join(seedDir, "generated/dataset.json"), "utf8")) as {
    suppliers: { code: string; name: string; email: string; paymentTermsDays: number }[];
  };
  const co = await db.query.company.findFirst();
  for (const s of seedData.suppliers) {
    if (!supplierByCode.has(s.code)) {
      const { supplier } = await import("@af/db");
      const [row] = await db
        .insert(supplier)
        .values({ companyId: co!.id, code: s.code, name: s.name, email: s.email, paymentTermsDays: s.paymentTermsDays })
        .onConflictDoNothing({ target: supplier.code })
        .returning();
      if (row) supplierByCode.set(s.code, row);
    }
  }
}

let stats: Record<string, number> = { purchases: 0, receipts: 0, invoices: 0, posted: 0, paid: 0, exceptions: 0, mismatches: 0, ublParsed: 0 };
const seenInvoices = new Map<string, { supplierInvoiceNumber: string; grossMinor: number; invoiceDate: string }[]>();

for (const chain of dataset.ap) {
  const sup = supplierByCode.get(chain.supplierCode);
  if (!sup) continue;

  // 1. Purchase (requisition + PO as one record)
  let purchaseRow: typeof purchase.$inferSelect | null = null;
  if (chain.po && chain.requisition) {
    const lines = toLines(chain.po.lines);
    [purchaseRow] = await db
      .insert(purchase)
      .values({
        number: chain.po.number,
        supplierId: sup.id,
        requestedBy: chain.requisition.requestedBy,
        businessNeed: chain.requisition.businessNeed,
        requestDate: chain.requisition.requestDate,
        approvalBand: chain.requisition.approvalBand,
        approvedBy: chain.requisition.approvedBy,
        approvedAt: new Date(`${chain.requisition.approvedAt}T09:00:00Z`),
        orderDate: chain.po.orderDate,
        lines,
        totalMinor: chain.po.totalMinor,
        status: "approved",
        documentPath: chain.po.file,
      })
      .returning();
    await commitPurchaseBudget(db, { lines, orderDate: chain.po.orderDate });
    stats.purchases++;
  }

  // 2. Goods receipt
  if (chain.grn && purchaseRow) {
    await db.insert(goodsReceipt).values({
      number: chain.grn.number,
      purchaseId: purchaseRow.id,
      receiptDate: chain.grn.date,
      quantities: chain.grn.qtyReceived.map((q, i) => ({ lineNo: i + 1, qtyReceived: q })),
      recordedBy: "ops",
    });
    await markPurchaseReceived(db, purchaseRow.id);
    stats.receipts++;
  }

  // 3. Invoice capture → match → post/pay or exception case
  const invLines = toLines(chain.invoice.lines);
  const [inv] = await db
    .insert(apInvoice)
    .values({
      supplierId: sup.id,
      supplierInvoiceNumber: chain.invoice.number,
      purchaseId: purchaseRow?.id ?? null,
      invoiceDate: chain.invoice.invoiceDate,
      dueDate: chain.invoice.dueDate,
      lines: invLines,
      netMinor: chain.invoice.netMinor,
      vatMinor: chain.invoice.vatMinor,
      grossMinor: chain.invoice.grossMinor,
      // Format mix: when the invoice arrived as XML or a scan, that alternate
      // file IS the primary document; the text PDF original stays on disk.
      documentPath: chain.invoice.altFile ?? chain.invoice.file,
      emailPath: chain.email.file,
      format: chain.invoice.format ?? "text_pdf",
    })
    .onConflictDoNothing({ target: [apInvoice.supplierId, apInvoice.supplierInvoiceNumber] })
    .returning();
  stats.invoices++;

  // e-invoices are structured data: parse the UBL and cross-check the chain
  if (chain.invoice.format === "ubl_xml" && chain.invoice.altFile) {
    const parsed = parseUblInvoice(readFileSync(path.join(seedDir, chain.invoice.altFile), "utf8"));
    if (!parsed || parsed.number !== chain.invoice.number || parsed.grossMinor !== chain.invoice.grossMinor) {
      stats.mismatches++;
      console.warn(`  UBL mismatch ${chain.id}: parsed=${parsed?.number}/${parsed?.grossMinor}`);
    } else {
      stats.ublParsed = (stats.ublParsed ?? 0) + 1;
    }
  }

  let derived: string | null = null;
  if (!inv) {
    // unique(supplier, number) blocked an exact duplicate: record it as a case-less skip
    derived = "duplicate_suspect";
  } else {
    // duplicate heuristics against this supplier's earlier invoices
    const prior = seenInvoices.get(chain.supplierCode) ?? [];
    const dup = isDuplicate(
      { supplierInvoiceNumber: chain.invoice.number, grossMinor: chain.invoice.grossMinor, invoiceDate: chain.invoice.invoiceDate },
      prior,
    );
    prior.push({ supplierInvoiceNumber: chain.invoice.number, grossMinor: chain.invoice.grossMinor, invoiceDate: chain.invoice.invoiceDate });
    seenInvoices.set(chain.supplierCode, prior);

    const received = chain.grn
      ? new Map(chain.grn.qtyReceived.map((q, i) => [i + 1, q]))
      : null;
    const match = threeWayMatch({
      purchase: purchaseRow ? { status: purchaseRow.status, lines: purchaseRow.lines } : null,
      received,
      invoiceLines: invLines,
    });

    if (looksLikeBankDetailChange(chain.email.body)) derived = "bank_detail_change";
    else if (dup.duplicate) derived = "duplicate_suspect";
    else if (match.result === "exception") derived = match.code;

    if (!derived) {
      await db.update(apInvoice).set({ status: "matched" }).where(eq(apInvoice.id, inv.id));
      await postApInvoice(db, inv.id, "loader");
      stats.posted++;
      if (chain.paid && chain.paidDate) {
        const [pay] = await db
          .insert(apPayment)
          .values({
            paymentRef: `PAY-${chain.invoice.number}`,
            runDate: chain.paidDate,
            invoiceIds: [inv.id],
            totalMinor: chain.invoice.grossMinor,
            status: "approved",
          })
          .returning();
        await executeApPayment(db, pay!.id, "loader");
        if (purchaseRow) await db.update(purchase).set({ status: "closed" }).where(eq(purchase.id, purchaseRow.id));
        stats.paid++;
      }
    } else {
      const detail = match.result === "exception" ? match.detail : dup.reason ?? "flagged by email screen";
      const [c] = await db
        .insert(evidenceCase)
        .values({
          kind: derived === "bank_detail_change" ? "fraud-risk" : "invoice-exception",
          title: `${derived}: ${sup.name} invoice ${chain.invoice.number}`,
        })
        .returning();
      await db.insert(caseEvent).values({
        caseId: c!.id,
        actorType: "system",
        actorId: "match-service",
        kind: "note",
        detail: { exceptionCode: derived, detail, invoiceId: inv.id, purchaseNumber: chain.po?.number ?? null },
      });
      await db
        .update(apInvoice)
        .set({ status: "exception", exceptionCode: derived, caseId: c!.id })
        .where(eq(apInvoice.id, inv.id));
      stats.exceptions++;
    }
  }

  // cross-check the Studio's planted code vs what the services derived
  if ((chain.exception ?? null) !== derived) {
    stats.mismatches++;
    console.warn(`  code mismatch ${chain.id}: planted=${chain.exception} derived=${derived}`);
  }
}

// 4. Bank feed; match payment lines to executed payments
const payments = await db.query.apPayment.findMany();
const payByRef = new Map(payments.map((p) => [p.paymentRef, p]));
for (const t of dataset.bank) {
  const pay = t.kind === "ap_payment" ? payByRef.get(`PAY-${t.reference}`) : undefined;
  await db.insert(bankTransaction).values({
    txnDate: t.date,
    amountMinor: t.amountMinor,
    reference: t.reference,
    counterparty: t.counterparty,
    kind: t.kind,
    status: pay ? "matched" : "unmatched",
    matchedType: pay ? "ap_payment" : null,
    matchedId: pay?.id ?? null,
  });
  if (pay) await db.update(apPayment).set({ status: "reconciled" }).where(eq(apPayment.id, pay.id));
}

console.log("loaded:", JSON.stringify(stats));
const [{ n: journals }] = (await db.execute(sql`select count(*) as n from erp.journal`)).rows as { n: string }[];
const [{ bal }] = (await db.execute(sql`select coalesce(sum(amount_minor),0) as bal from erp.journal_line`)).rows as { bal: string }[];
console.log(`journals: ${journals}, ledger balance check (must be 0): ${bal}`);
await pool.end();
if (stats.mismatches > 0) process.exit(1);
