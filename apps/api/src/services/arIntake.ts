/** O2C intake + cash application (plans/O2C.md). Same posture as P2P: the
 * module pushes the business event WITH its accounting through the one pipe.
 * Deterministic matcher applies receipts where code can decide; the Cash
 * Application Agent proposes the rest (always human-approved). */
import { and, eq, lt } from "drizzle-orm";
import { arInvoice, bankTransaction, type Db, type PurchaseLine } from "@af/db";
import { postEvent } from "./fdpPost.js";
import { ACCOUNTS } from "./policy.js";

const RECEIVABLES = "1100";

/** Pure: revenue deltas for an AR invoice — DR receivables gross, CR revenue
 * per line account, CR VAT control. */
export function arInvoiceDeltas(inv: {
  lines: PurchaseLine[];
  vatMinor: number;
  grossMinor: number;
}): { accountCode: string; amountMinor: number; memo?: string }[] {
  const byAccount = new Map<string, number>();
  for (const l of inv.lines)
    byAccount.set(l.accountCode, (byAccount.get(l.accountCode) ?? 0) + l.qty * l.unitPriceMinor);
  const deltas = [{ accountCode: RECEIVABLES, amountMinor: inv.grossMinor, memo: "Trade receivables" }];
  for (const [accountCode, amountMinor] of byAccount)
    deltas.push({ accountCode, amountMinor: -amountMinor, memo: "Revenue" });
  if (inv.vatMinor !== 0) deltas.push({ accountCode: ACCOUNTS.vatControl, amountMinor: -inv.vatMinor, memo: "VAT" });
  return deltas;
}

/** Post an issued AR invoice to the ledger. Idempotent per invoice. */
export async function postArInvoice(db: Db, invoiceId: string, postedBy: string): Promise<{ journalId: string }> {
  const inv = await db.query.arInvoice.findFirst({ where: (t) => eq(t.id, invoiceId) });
  if (!inv) throw new Error("ar invoice not found");
  if (inv.status !== "issued") throw new Error(`cannot post AR invoice in status ${inv.status}`);
  const posted = await postEvent(db, {
    eventType: "ar.invoice.posted",
    occurredAt: inv.invoiceDate,
    sourceSystem: "api",
    sourceEventKey: `ar.invoice.posted:${inv.id}`,
    objectType: "ar_invoice",
    objectId: inv.id,
    details: { number: inv.number, grossMinor: inv.grossMinor },
    deltas: arInvoiceDeltas(inv),
    memo: `AR invoice ${inv.number}`,
    postedBy,
  });
  await db.update(arInvoice).set({ status: "posted", journalId: posted.journalId }).where(eq(arInvoice.id, inv.id));
  return { journalId: posted.journalId };
}

/** Apply one bank receipt to one AR invoice: DR bank, CR receivables; marks
 * the bank line matched and the invoice paid. The executor behind the
 * ar.receipt.apply command and the deterministic matcher both land here. */
export async function applyReceipt(
  db: Db,
  params: { bankTransactionId: string; invoiceId: string; postedBy: string },
): Promise<{ journalId: string }> {
  const txn = await db.query.bankTransaction.findFirst({ where: (t) => eq(t.id, params.bankTransactionId) });
  if (!txn) throw Object.assign(new Error("bank transaction not found"), { statusCode: 404 });
  if (txn.status === "matched") throw Object.assign(new Error("bank line already matched"), { statusCode: 409 });
  const inv = await db.query.arInvoice.findFirst({ where: (t) => eq(t.id, params.invoiceId) });
  if (!inv) throw Object.assign(new Error("ar invoice not found"), { statusCode: 404 });
  if (inv.status === "paid") throw Object.assign(new Error("invoice already paid"), { statusCode: 409 });
  if (txn.amountMinor !== inv.grossMinor)
    throw Object.assign(
      new Error(`amount mismatch: receipt ${txn.amountMinor} vs invoice ${inv.grossMinor} (part-payments are out of scope)`),
      { statusCode: 409 },
    );

  const posted = await postEvent(db, {
    eventType: "ar.receipt.posted",
    occurredAt: txn.txnDate,
    sourceSystem: "api",
    sourceEventKey: `ar.receipt.posted:${txn.id}`,
    objectType: "ar_invoice",
    objectId: inv.id,
    details: { number: inv.number, reference: txn.reference },
    deltas: [
      { accountCode: ACCOUNTS.bank, amountMinor: txn.amountMinor, memo: txn.reference },
      { accountCode: RECEIVABLES, amountMinor: -txn.amountMinor, memo: `Receipt ${inv.number}` },
    ],
    memo: `Customer receipt ${inv.number}`,
    postedBy: params.postedBy,
    journalSource: { type: "ar_receipt", id: txn.id },
  });
  await db
    .update(bankTransaction)
    .set({ status: "matched", matchedType: "ar_invoice", matchedId: inv.id })
    .where(eq(bankTransaction.id, txn.id));
  await db
    .update(arInvoice)
    .set({ status: "paid", receiptJournalId: posted.journalId })
    .where(eq(arInvoice.id, inv.id));
  return { journalId: posted.journalId };
}

/** Deterministic cash application: reference equals invoice number AND
 * amount equals gross. Everything else stays for the agent. */
export async function applyReceiptsByRule(
  db: Db,
  postedBy = "cash-application-rules",
): Promise<{ applied: number; leftovers: number }> {
  const open = await db.query.bankTransaction.findMany({
    where: (t) => and(eq(t.status, "unmatched"), eq(t.kind, "ar_receipt")),
  });
  let applied = 0;
  for (const txn of open) {
    const inv = await db.query.arInvoice.findFirst({
      where: (t) => and(eq(t.number, txn.reference), eq(t.grossMinor, txn.amountMinor)),
    });
    if (!inv || inv.status === "paid") continue;
    await applyReceipt(db, { bankTransactionId: txn.id, invoiceId: inv.id, postedBy });
    applied++;
  }
  return { applied, leftovers: open.length - applied };
}

/** Overdue book for collections: posted, unpaid, past due. */
export async function overdueInvoices(db: Db, asOf = new Date().toISOString().slice(0, 10)) {
  return db.query.arInvoice.findMany({
    where: (t) => and(eq(t.status, "posted"), lt(t.dueDate, asOf)),
    orderBy: (t) => t.dueDate,
  });
}
