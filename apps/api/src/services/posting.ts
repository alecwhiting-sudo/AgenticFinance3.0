/** The posting service — the ONLY writer of journals (ARCHITECTURE.md §3,
 * CLAUDE.md journal rules). Balanced, append-only, period-checked, with
 * source uniqueness enforced by the schema. Also maintains category budgets
 * (commitment accounting lite, plans/P2P.md §2). */
import { and, eq, sql } from "drizzle-orm";
import {
  apInvoice,
  apPayment,
  categoryBudget,
  journal,
  journalLine,
  purchase,
  type Db,
  type PurchaseLine,
} from "@af/db";
import { ACCOUNTS } from "./policy.js";

export type JournalLineInput = { accountCode: string; amountMinor: number; memo?: string };

/** Pure validation: balanced, non-empty, no zero lines. */
export function validateJournalLines(lines: JournalLineInput[]): string | null {
  if (lines.length < 2) return "journal needs at least two lines";
  if (lines.some((l) => l.amountMinor === 0)) return "zero-amount journal line";
  const sum = lines.reduce((n, l) => n + l.amountMinor, 0);
  if (sum !== 0) return `journal does not balance (sum ${sum})`;
  return null;
}

async function assertPeriodOpen(db: Db, journalDate: string): Promise<string> {
  const periodCode = journalDate.slice(0, 7);
  const period = await db.query.fiscalPeriod.findFirst({
    where: (t, { eq: e }) => e(t.code, periodCode),
  });
  if (!period) throw new Error(`no fiscal period for ${periodCode}`);
  if (period.status !== "open") throw new Error(`period ${periodCode} is closed`);
  return periodCode;
}

export async function postJournal(
  db: Db,
  input: {
    journalDate: string;
    memo: string;
    sourceType: string;
    sourceId: string;
    postedBy: string;
    lines: JournalLineInput[];
  },
): Promise<{ id: string; number: number }> {
  const invalid = validateJournalLines(input.lines);
  if (invalid) throw new Error(invalid);
  const periodCode = await assertPeriodOpen(db, input.journalDate);
  const co = await db.query.company.findFirst();
  if (!co) throw new Error("no company");

  return db.transaction(async (tx) => {
    // Gapless journal numbering needs max()+1, which races when the loader
    // and worker-driven commands post concurrently (cold-start demo). The
    // advisory xact lock serialises allocation; it releases on commit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('erp.journal.number'))`);
    const [{ next }] = (
      await tx.execute(sql`select coalesce(max(number), 0) + 1 as next from erp.journal`)
    ).rows as { next: number }[];
    const [j] = await tx
      .insert(journal)
      .values({
        companyId: co.id,
        number: Number(next),
        journalDate: input.journalDate,
        periodCode,
        memo: input.memo,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        postedBy: input.postedBy,
      })
      .returning();
    await tx.insert(journalLine).values(
      input.lines.map((l, i) => ({
        journalId: j!.id,
        lineNo: i + 1,
        accountCode: l.accountCode,
        amountMinor: l.amountMinor,
        memo: l.memo,
      })),
    );
    return { id: j!.id, number: Number(next) };
  });
}

/** DR expense per line account, DR VAT control, CR trade payables. */
export function apInvoiceJournalLines(inv: {
  lines: PurchaseLine[];
  vatMinor: number;
  grossMinor: number;
}): JournalLineInput[] {
  const byAccount = new Map<string, number>();
  for (const l of inv.lines)
    byAccount.set(l.accountCode, (byAccount.get(l.accountCode) ?? 0) + l.qty * l.unitPriceMinor);
  const lines: JournalLineInput[] = [...byAccount.entries()].map(([accountCode, amountMinor]) => ({
    accountCode,
    amountMinor,
  }));
  if (inv.vatMinor !== 0) lines.push({ accountCode: ACCOUNTS.vatControl, amountMinor: inv.vatMinor, memo: "VAT" });
  lines.push({ accountCode: ACCOUNTS.tradePayables, amountMinor: -inv.grossMinor, memo: "Trade payables" });
  return lines;
}

export async function postApInvoice(
  db: Db,
  invoiceId: string,
  postedBy: string,
): Promise<{ journalId: string }> {
  const inv = await db.query.apInvoice.findFirst({ where: (t, { eq: e }) => e(t.id, invoiceId) });
  if (!inv) throw new Error("invoice not found");
  if (inv.status !== "matched" && inv.status !== "approved")
    throw new Error(`cannot post invoice in status ${inv.status}`);

  // D13: the module pushes the business event WITH its accounting attached
  // (the agent/intake coded the lines); the platform validates and posts.
  const { postEvent } = await import("./fdpPost.js");
  const posted = await postEvent(db, {
    eventType: "ap.invoice.posted",
    occurredAt: inv.invoiceDate,
    sourceSystem: "api",
    sourceEventKey: `ap.invoice.posted:${inv.id}`,
    objectType: "ap_invoice",
    objectId: inv.id,
    details: { supplierInvoiceNumber: inv.supplierInvoiceNumber, grossMinor: inv.grossMinor },
    deltas: apInvoiceJournalLines(inv),
    memo: `AP invoice ${inv.supplierInvoiceNumber}`,
    postedBy,
  });
  const j = { id: posted.journalId };
  await db.update(apInvoice).set({ status: "posted", journalId: j.id }).where(eq(apInvoice.id, inv.id));

  // committed -> actual per line account/period
  const periodCode = inv.invoiceDate.slice(0, 7);
  for (const l of inv.lines) {
    const amt = l.qty * l.unitPriceMinor;
    await db
      .update(categoryBudget)
      .set({
        actualMinor: sql`${categoryBudget.actualMinor} + ${amt}`,
        committedMinor: sql`greatest(${categoryBudget.committedMinor} - ${amt}, 0)`,
      })
      .where(and(eq(categoryBudget.accountCode, l.accountCode), eq(categoryBudget.periodCode, periodCode)));
  }
  return { journalId: j.id };
}

export async function executeApPayment(
  db: Db,
  paymentId: string,
  postedBy: string,
): Promise<{ journalId: string }> {
  const pay = await db.query.apPayment.findFirst({ where: (t, { eq: e }) => e(t.id, paymentId) });
  if (!pay) throw new Error("payment not found");
  if (pay.status !== "proposed" && pay.status !== "approved")
    throw new Error(`cannot execute payment in status ${pay.status}`);

  const { postEvent } = await import("./fdpPost.js");
  const posted = await postEvent(db, {
    eventType: "ap.payment.executed",
    occurredAt: pay.runDate,
    sourceSystem: "api",
    sourceEventKey: `ap.payment.executed:${pay.id}`,
    objectType: "ap_payment",
    objectId: pay.id,
    details: { paymentRef: pay.paymentRef, invoiceCount: pay.invoiceIds.length },
    deltas: [
      { accountCode: ACCOUNTS.tradePayables, amountMinor: pay.totalMinor, memo: "Settle payables" },
      { accountCode: ACCOUNTS.bank, amountMinor: -pay.totalMinor, memo: "Bank out" },
    ],
    memo: `Payment run ${pay.paymentRef}`,
    postedBy,
  });
  const j = { id: posted.journalId };
  await db
    .update(apPayment)
    .set({ status: "executed", executedAt: new Date(), journalId: j.id })
    .where(eq(apPayment.id, pay.id));
  for (const invId of pay.invoiceIds)
    await db.update(apInvoice).set({ status: "paid" }).where(eq(apInvoice.id, invId));
  return { journalId: j.id };
}

/** Approving a purchase commits budget (plans/P2P.md §2). */
export async function commitPurchaseBudget(db: Db, p: { lines: PurchaseLine[]; orderDate: string }): Promise<void> {
  const periodCode = p.orderDate.slice(0, 7);
  for (const l of p.lines) {
    const amt = l.qty * l.unitPriceMinor;
    const updated = await db
      .update(categoryBudget)
      .set({ committedMinor: sql`${categoryBudget.committedMinor} + ${amt}` })
      .where(and(eq(categoryBudget.accountCode, l.accountCode), eq(categoryBudget.periodCode, periodCode)))
      .returning();
    if (updated.length === 0) {
      await db.insert(categoryBudget).values({
        accountCode: l.accountCode,
        periodCode,
        budgetMinor: 0,
        committedMinor: amt,
      });
    }
  }
}

export async function markPurchaseReceived(db: Db, purchaseId: string): Promise<void> {
  const p = await db.query.purchase.findFirst({ where: (t, { eq: e }) => e(t.id, purchaseId) });
  if (!p) return;
  const receipts = await db.query.goodsReceipt.findMany({
    where: (t, { eq: e }) => e(t.purchaseId, purchaseId),
  });
  const received = new Map<number, number>();
  for (const r of receipts)
    for (const q of r.quantities) received.set(q.lineNo, (received.get(q.lineNo) ?? 0) + q.qtyReceived);
  const full = p.lines.every((l) => (received.get(l.lineNo) ?? 0) >= l.qty);
  await db
    .update(purchase)
    .set({ status: full ? "received" : "partially_received" })
    .where(eq(purchase.id, purchaseId));
}
