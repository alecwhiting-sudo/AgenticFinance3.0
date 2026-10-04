/**
 * Demo dataset loader as a service (admin panel + CLI script both use it).
 * Loads the Studio dataset through the SAME deterministic intake services
 * the runtime uses: purchases → receipts → invoices → 3-way match →
 * post/pay or exception case → bank feed. The match service re-deriving the
 * Studio's planted exception codes is a built-in cross-check.
 *
 * Modes:
 *  - instant (default): bulk load, as fast as the DB allows
 *  - live: paced per chain with activity events, so the workbench's live
 *    feed and flow view show the whole book being built from zero
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import {
  seedCore,
  apInvoice,
  apPayment,
  bankTransaction,
  caseEvent,
  categoryBudget,
  evidenceCase,
  goodsReceipt,
  purchase,
  supplier,
  arInvoice,
  customer,
  workItem,
  type Db,
  type PurchaseLine,
} from "@af/db";
import { threeWayMatch, isDuplicate } from "./match.js";
import { applyReceiptsByRule, postArInvoice } from "./arIntake.js";
import { parseUblInvoice } from "./ubl.js";
import {
  commitPurchaseBudget,
  executeApPayment,
  markPurchaseReceived,
  postApInvoice,
} from "./posting.js";
import { emitActivity } from "../lib/activity.js";

export const seedDir = path.resolve(
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
type StudioArInvoice = {
  id: string;
  customerCode: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  lines: StudioLine[];
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  file: string;
  contractFile: string | null;
  paid: boolean;
  paidDate: string | null;
  remittanceFile: string | null;
};
export type StudioDataset = {
  ap: StudioChain[];
  ar: StudioArInvoice[];
  customers: { code: string; name: string; email: string; paymentTermsDays: number }[];
  bank: { date: string; amountMinor: number; reference: string; counterparty: string; kind: string }[];
};

const toLines = (ls: StudioLine[]): PurchaseLine[] =>
  ls.map((l, i) => ({ lineNo: i + 1, description: l.description, qty: l.qty, unitPriceMinor: l.unitPriceMinor, accountCode: l.account }));

/** Fraud screen: untrusted email text asking to change bank details. */
export const looksLikeBankDetailChange = (body: string): boolean =>
  /\b(sort\s*code|bank(ing)?\s+details?|account\s+number|remit.*to)\b/i.test(body) &&
  /\bchang|new account|immediate effect|updated bank/i.test(body);

// Demo monthly budgets per expense account (pence) for commitment tracking.
const MONTHLY_BUDGETS: Record<string, number> = {
  "5000": 2_500_000, "6000": 5_600_000, "6100": 1_200_000, "6200": 900_000,
  "6300": 400_000, "6400": 900_000, "6500": 900_000, "6900": 300_000,
};

export type LoadOptions = {
  reset?: boolean;
  /** truncate the transaction tables and stop — "from zero" state */
  truncateOnly?: boolean;
  /** incremental: load only the next unloaded dataset month (no truncate).
   * Drives the month-by-month demo scenario (plans/DEMO_SCRIPTS.md §2). */
  nextMonthOnly?: boolean;
  /** cold start: internal records (purchases, GRNs, AR billing, bank feed)
   * load as system data, but supplier invoices are NOT posted — each one is
   * queued as a document for the Invoice Extraction Agent, exactly like
   * inbound mail (the drip path). Real model work, real cost; payments are
   * then run from the payments page once the queue drains. */
  coldStart?: boolean;
  /** pace per chain in ms; >0 also emits per-chain activity events */
  paceMs?: number;
  onProgress?: (done: number, total: number, message: string) => void;
  log?: (msg: string) => void;
};

export type LoadResult =
  | { skipped: true; reason?: string }
  | { skipped?: false; stats: Record<string, number>; journals: number; balance: number; monthLoaded?: string | null };

const monthOf = (d: string) => d.slice(0, 7);

/** Full profile of the committed test dataset (static — cached): what the
 * Test panel shows before any scenario runs, so the audience knows exactly
 * what data exists. */
let profileCache: Record<string, unknown> | null = null;
export function datasetProfile(): Record<string, unknown> {
  if (profileCache) return profileCache;
  const d: StudioDataset & { suppliers?: unknown[]; customers?: unknown[] } = JSON.parse(
    readFileSync(path.join(seedDir, "generated/dataset.json"), "utf8"),
  );
  const formats: Record<string, number> = {};
  const exceptions: Record<string, number> = {};
  let grns = 0;
  for (const c of d.ap) {
    const f = c.invoice.format ?? "text_pdf";
    formats[f] = (formats[f] ?? 0) + 1;
    if (c.grn) grns++;
    if (c.exception) exceptions[c.exception] = (exceptions[c.exception] ?? 0) + 1;
  }
  const bankKinds: Record<string, number> = {};
  for (const b of d.bank) bankKinds[b.kind] = (bankKinds[b.kind] ?? 0) + 1;
  profileCache = {
    months: datasetMonthTotals(),
    ap: { chains: d.ap.length, goodsReceipts: grns, formats, plantedExceptions: exceptions },
    ar: {
      invoices: d.ar.length,
      contracts: d.ar.filter((a) => a.contractFile).length,
      remittances: d.ar.filter((a) => a.remittanceFile).length,
    },
    bank: { lines: d.bank.length, kinds: bankKinds },
    masters: { suppliers: (d.suppliers ?? []).length, customers: d.customers.length },
  };
  return profileCache;
}

/** Per-month transaction totals of the committed dataset (static — cached). */
let monthTotalsCache: { month: string; ap: number; ar: number; bank: number }[] | null = null;
export function datasetMonthTotals(): { month: string; ap: number; ar: number; bank: number }[] {
  if (monthTotalsCache) return monthTotalsCache;
  const d: StudioDataset = JSON.parse(readFileSync(path.join(seedDir, "generated/dataset.json"), "utf8"));
  const map = new Map<string, { ap: number; ar: number; bank: number }>();
  const bump = (m: string, k: "ap" | "ar" | "bank") => {
    const row = map.get(m) ?? { ap: 0, ar: 0, bank: 0 };
    row[k]++;
    map.set(m, row);
  };
  for (const c of d.ap) bump(monthOf(c.invoice.invoiceDate), "ap");
  for (const a of d.ar) bump(monthOf(a.invoiceDate), "ar");
  for (const b of d.bank) bump(monthOf(b.date), "bank");
  monthTotalsCache = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, v]) => ({ month, ...v }));
  return monthTotalsCache;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Truncate all transaction data (ERP docs, journals, FDP events/movements,
 * cases, work queue leftovers). Master data, agents and skills survive. */
export async function truncateTransactions(db: Db): Promise<void> {
  // Row-level immutability triggers guard UPDATE/DELETE; TRUNCATE is the
  // controlled demo-reset path (it fires no row triggers by design).
  await db.execute(sql`
    truncate table erp.journal_line, erp.journal, erp.bank_transaction, erp.ap_payment,
      erp.ap_invoice, erp.goods_receipt, erp.purchase, erp.category_budget,
      erp.report_commentary, erp.ar_dunning, erp.ar_invoice, fdp.movement, fdp.event cascade`);
  // Pending proposals, unworked queue items and evidence cases reference the
  // wiped transactions — stale "awaiting approval" counts on empty books
  // confuse demos. Executed commands and agent runs survive (D14 history);
  // no TRUNCATE CASCADE here because agent_run FKs work_item.
  await db.execute(sql`delete from agent.command where status = 'proposed'`);
  await db.execute(sql`
    delete from agent.work_item w
    where w.status in ('pending', 'claimed', 'running')
      and not exists (select 1 from agent.agent_run r where r.work_item_id = w.id)`);
  await db.execute(sql`delete from evidence.case_event`);
  await db.execute(sql`update evidence.document set case_id = null where case_id is not null`);
  await db.execute(sql`delete from evidence."case"`);
}

export async function loadDemoDataset(db: Db, opts: LoadOptions = {}): Promise<LoadResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const pace = opts.paceMs ?? 0;
  const dataset: StudioDataset = JSON.parse(
    readFileSync(path.join(seedDir, "generated/dataset.json"), "utf8"),
  );

  await seedCore(db);
  const companyRow = await db.query.company.findFirst();
  if (!companyRow) throw new Error("core seed did not produce a company row");

  // Month window for incremental loading: months in (from, to] load this call.
  let window: { from: string | null; to: string } | null = null;
  if (opts.nextMonthOnly) {
    const allMonths = datasetMonthTotals().map((m) => m.month);
    // Boundary = last dataset month with rows in the books. Ignore anything
    // dated beyond the dataset (dripped invoices are dated "today", which
    // would otherwise make every month look already loaded).
    const afterLast = new Date(`${allMonths[allMonths.length - 1]}-01T00:00:00Z`);
    afterLast.setUTCMonth(afterLast.getUTCMonth() + 1);
    const horizon = afterLast.toISOString().slice(0, 10); // first day after the dataset's last month
    const [{ m }] = (
      await db.execute(sql`
        select greatest(
          (select max(invoice_date) from erp.ap_invoice where book <> 'test' and invoice_date < ${horizon}::date),
          (select max(invoice_date) from erp.ar_invoice where invoice_date < ${horizon}::date),
          (select max(txn_date) from erp.bank_transaction where txn_date < ${horizon}::date)
        )::text as m`)
    ).rows as { m: string | null }[];
    const loadedUpTo = m ? m.slice(0, 7) : null;
    const target = allMonths.find((x) => !loadedUpTo || x > loadedUpTo);
    if (!target) {
      log("all dataset months already loaded");
      return { skipped: true, reason: "all dataset months already loaded" };
    }
    window = { from: loadedUpTo, to: target };
    log(`loading dataset month ${target}`);
  } else {
    const existing = await db.select({ n: sql<number>`count(*)` }).from(purchase);
    if (Number(existing[0]!.n) > 0) {
      if (!opts.reset && !opts.truncateOnly) {
        log("P2P data already loaded — reset required to reload");
        return { skipped: true };
      }
      await truncateTransactions(db);
      log("transaction tables truncated");
    }
  }
  if (opts.truncateOnly) return { skipped: false, stats: {}, journals: 0, balance: 0 };

  const inWindow = (d: string) => {
    if (!window) return true;
    const mm = monthOf(d);
    return (window.from === null || mm > window.from) && mm <= window.to;
  };
  const apChains = dataset.ap.filter((c) => inWindow(c.invoice.invoiceDate));
  const arRows = dataset.ar.filter((a) => inWindow(a.invoiceDate));
  const bankRows = dataset.bank.filter((b) => inWindow(b.date));

  // budgets Apr–Mar (12 seeded periods)
  const periods = await db.query.fiscalPeriod.findMany();
  for (const p of periods)
    for (const [accountCode, budgetMinor] of Object.entries(MONTHLY_BUDGETS))
      await db.insert(categoryBudget).values({ accountCode, periodCode: p.code, budgetMinor }).onConflictDoNothing();

  const suppliers = await db.query.supplier.findMany();
  const supplierByCode = new Map(suppliers.map((s) => [s.code, s]));
  {
    const seedData = JSON.parse(readFileSync(path.join(seedDir, "generated/dataset.json"), "utf8")) as {
      suppliers: { code: string; name: string; email: string; paymentTermsDays: number }[];
    };
    for (const s of seedData.suppliers) {
      if (!supplierByCode.has(s.code)) {
        const [row] = await db
          .insert(supplier)
          .values({ companyId: companyRow.id, code: s.code, name: s.name, email: s.email, paymentTermsDays: s.paymentTermsDays })
          .onConflictDoNothing({ target: supplier.code })
          .returning();
        if (row) supplierByCode.set(s.code, row);
      }
    }
  }

  const stats: Record<string, number> = { purchases: 0, receipts: 0, invoices: 0, posted: 0, paid: 0, exceptions: 0, mismatches: 0, ublParsed: 0 };
  const seenInvoices = new Map<string, { supplierInvoiceNumber: string; grossMinor: number; invoiceDate: string }[]>();
  // incremental loads: duplicate detection must also see what earlier months loaded
  if (window) {
    const prior = (
      await db.execute(sql`
        select s.code, i.supplier_invoice_number as num, i.gross_minor as gross, i.invoice_date::text as d
        from erp.ap_invoice i join erp.supplier s on s.id = i.supplier_id where i.book <> 'test'`)
    ).rows as { code: string; num: string; gross: number; d: string }[];
    for (const r of prior) {
      const list = seenInvoices.get(r.code) ?? [];
      list.push({ supplierInvoiceNumber: r.num, grossMinor: Number(r.gross), invoiceDate: r.d });
      seenInvoices.set(r.code, list);
    }
  }
  const total = apChains.length + 2; // + bank feed + AR load steps
  let done = 0;

  const extractionAgent = opts.coldStart
    ? await db.query.agent.findFirst({ where: (t) => eq(t.slug, "invoice-extraction") })
    : null;
  if (opts.coldStart && !extractionAgent) throw new Error("cold start needs the invoice-extraction agent seeded");

  for (const chain of apChains) {
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
      stats.purchases!++;
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
      stats.receipts!++;
    }

    // Cold start: don't post the invoice — queue the document for the
    // Invoice Extraction Agent, payload identical to the drip path.
    if (opts.coldStart) {
      const isScan = chain.invoice.format === "scan_pdf";
      await db.insert(workItem).values({
        type: "invoice.capture",
        agentId: extractionAgent!.id,
        payload: isScan
          ? {
              documentPath: chain.invoice.altFile ?? chain.invoice.file,
              format: "scan_pdf",
              supplierCode: chain.supplierCode,
              emailText: chain.email.body,
              fallbackData: {
                number: chain.invoice.number,
                invoiceDate: chain.invoice.invoiceDate,
                dueDate: chain.invoice.dueDate,
                po: chain.po?.number ?? null,
                lines: chain.invoice.lines,
                netMinor: chain.invoice.netMinor,
                vatMinor: chain.invoice.vatMinor,
                grossMinor: chain.invoice.grossMinor,
              },
            }
          : {
              documentText: `AF-DATA ${JSON.stringify({
                kind: "ap_invoice",
                supplier: sup.name,
                number: chain.invoice.number,
                invoiceDate: chain.invoice.invoiceDate,
                dueDate: chain.invoice.dueDate,
                po: chain.po?.number ?? null,
                netMinor: chain.invoice.netMinor,
                vatMinor: chain.invoice.vatMinor,
                grossMinor: chain.invoice.grossMinor,
                lines: chain.invoice.lines,
              })}`,
              emailText: chain.email.body,
              supplierCode: chain.supplierCode,
            },
        priority: 5,
      });
      stats.queued = (stats.queued ?? 0) + 1;
      done++;
      opts.onProgress?.(done, total, `${chain.invoice.number} queued for extraction`);
      if (pace > 0) await sleep(pace);
      continue;
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
        documentPath: chain.invoice.altFile ?? chain.invoice.file,
        emailPath: chain.email.file,
        format: chain.invoice.format ?? "text_pdf",
      })
      .onConflictDoNothing({ target: [apInvoice.supplierId, apInvoice.supplierInvoiceNumber] })
      .returning();
    stats.invoices!++;

    // e-invoices are structured data: parse the UBL and cross-check the chain
    if (chain.invoice.format === "ubl_xml" && chain.invoice.altFile) {
      const parsed = parseUblInvoice(readFileSync(path.join(seedDir, chain.invoice.altFile), "utf8"));
      if (!parsed || parsed.number !== chain.invoice.number || parsed.grossMinor !== chain.invoice.grossMinor) {
        stats.mismatches!++;
        log(`  UBL mismatch ${chain.id}: parsed=${parsed?.number}/${parsed?.grossMinor}`);
      } else {
        stats.ublParsed = (stats.ublParsed ?? 0) + 1;
      }
    }

    let derived: string | null = null;
    if (!inv) {
      derived = "duplicate_suspect";
    } else {
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
        stats.posted!++;
        // month mode: a payment dated in a later month waits for that month's load
        if (chain.paid && chain.paidDate && (!window || monthOf(chain.paidDate) <= window.to)) {
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
          stats.paid!++;
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
        stats.exceptions!++;
      }
    }

    if ((chain.exception ?? null) !== derived) {
      stats.mismatches!++;
      log(`  code mismatch ${chain.id}: planted=${chain.exception} derived=${derived}`);
    }

    done++;
    opts.onProgress?.(done, total, `${chain.invoice.number} ${derived ?? (chain.paid ? "paid" : "posted")}`);
    if (pace > 0) {
      await emitActivity({
        actorType: "system",
        actorId: "demo-replay",
        verb: derived ? "raised_exception" : "posted_straight_through",
        objectType: "ap_invoice",
        objectId: inv?.id ?? chain.id,
        summary: derived
          ? `${sup.name} ${chain.invoice.number} — ${derived}, case opened`
          : `${sup.name} ${chain.invoice.number} matched ${chain.po?.number ?? ""} and ${chain.paid ? "paid" : "posted"}`,
      });
      await sleep(pace);
    }
  }

  // 3b. Month mode catch-up: pay invoices loaded in earlier months whose
  // payment date lands in this window. (Not in cold start — there, payments
  // are run from the payments page once the agents have the invoices posted.)
  if (window && !opts.coldStart) {
    for (const chain of dataset.ap) {
      if (!chain.paid || !chain.paidDate) continue;
      if (inWindow(chain.invoice.invoiceDate)) continue; // handled above
      const payM = monthOf(chain.paidDate);
      if (!((window.from === null || payM > window.from) && payM <= window.to)) continue;
      const sup = supplierByCode.get(chain.supplierCode);
      if (!sup) continue;
      const inv = await db.query.apInvoice.findFirst({
        where: (t) => and(eq(t.supplierId, sup.id), eq(t.supplierInvoiceNumber, chain.invoice.number)),
      });
      if (!inv || inv.status !== "posted") continue;
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
      if (inv.purchaseId) await db.update(purchase).set({ status: "closed" }).where(eq(purchase.id, inv.purchaseId));
      stats.paid!++;
    }
  }

  // 4. Bank feed; match payment lines to executed payments
  const payments = await db.query.apPayment.findMany();
  const payByRef = new Map(payments.map((p) => [p.paymentRef, p]));
  for (const t of bankRows) {
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
  done++;
  opts.onProgress?.(done, total, "bank feed loaded");

  // 5. O2C: customers, AR invoices posted through the pipe, receipts applied
  // by the deterministic matcher against the bank lines just loaded.
  const customers = await db.query.customer.findMany();
  const customerByCode = new Map(customers.map((c) => [c.code, c]));
  for (const c of dataset.customers) {
    if (!customerByCode.has(c.code)) {
      const [row] = await db
        .insert(customer)
        .values({ companyId: companyRow.id, code: c.code, name: c.name, email: c.email, paymentTermsDays: c.paymentTermsDays })
        .onConflictDoNothing({ target: customer.code })
        .returning();
      if (row) customerByCode.set(c.code, row);
    }
  }
  for (const a of arRows) {
    const cust = customerByCode.get(a.customerCode);
    if (!cust) continue;
    const [inv] = await db
      .insert(arInvoice)
      .values({
        number: a.number,
        customerId: cust.id,
        invoiceDate: a.invoiceDate,
        dueDate: a.dueDate,
        lines: toLines(a.lines),
        netMinor: a.netMinor,
        vatMinor: a.vatMinor,
        grossMinor: a.grossMinor,
        documentPath: a.file,
        contractPath: a.contractFile,
        remittancePath: a.remittanceFile,
      })
      .onConflictDoNothing({ target: arInvoice.number })
      .returning();
    if (!inv) continue;
    await postArInvoice(db, inv.id, "loader");
    stats.arInvoices = (stats.arInvoices ?? 0) + 1;
    if (opts.paceMs && stats.arInvoices % 25 === 0)
      await emitActivity({
        actorType: "system",
        actorId: "demo-replay",
        verb: "posted_straight_through",
        objectType: "ar_invoice",
        objectId: inv.id,
        summary: `AR billing: ${stats.arInvoices} customer invoices posted`,
      });
  }
  const { applied, leftovers } = await applyReceiptsByRule(db, "loader");
  stats.receiptsApplied = applied;
  stats.receiptsLeft = leftovers;
  done++;
  opts.onProgress?.(done, total, `AR loaded, ${applied} receipts applied`);

  log(`loaded: ${JSON.stringify(stats)}`);
  const [{ n: journals }] = (await db.execute(sql`select count(*) as n from erp.journal where book <> 'test'`)).rows as { n: string }[];
  const [{ bal }] = (await db.execute(sql`select coalesce(sum(amount_minor),0) as bal from erp.journal_line`)).rows as { bal: string }[];
  log(`journals: ${journals}, ledger balance check (must be 0): ${bal}`);
  return { stats, journals: Number(journals), balance: Number(bal), monthLoaded: window?.to ?? null };
}
