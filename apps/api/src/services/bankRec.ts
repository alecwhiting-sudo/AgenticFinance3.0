/** Bank reconciliation beyond AP payments (plans/R2R.md §2).
 * Deterministic kind-rules post and match the obvious lines through the FDP
 * pipe; ambiguous lines go to the Reconciliation Agent, whose proposal
 * (`bank.txn.post`) is a human-approved command executed here. AR receipts
 * are deferred to O2C — categorised, never posted here. */
import { and, eq } from "drizzle-orm";
import { bankTransaction, type Db } from "@af/db";
import { postEvent } from "./fdpPost.js";
import { ACCOUNTS } from "./policy.js";

/** kind → P&L/BS account for the balancing side of the bank movement. */
export const BANK_RULES: Record<string, { accountCode: string; memo: string }> = {
  salaries: { accountCode: "6000", memo: "Payroll run (net)" },
  vat: { accountCode: "2200", memo: "VAT payment to HMRC" },
  bank_fees: { accountCode: "6900", memo: "Bank charges" },
};

/** Post one bank line against an account and mark it matched. The journal is
 * always: bank side = txn amount, other side = the negation — balanced by
 * construction, re-proven by the deferred DB constraint. */
export async function postBankTxn(
  db: Db,
  params: { bankTransactionId: string; accountCode: string; memo: string; postedBy: string },
): Promise<{ journalId: string }> {
  const txn = await db.query.bankTransaction.findFirst({
    where: (t) => eq(t.id, params.bankTransactionId),
  });
  if (!txn) throw Object.assign(new Error("bank transaction not found"), { statusCode: 404 });
  if (txn.status === "matched")
    throw Object.assign(new Error("bank transaction already matched"), { statusCode: 409 });

  const posted = await postEvent(db, {
    eventType: "bank.txn.posted",
    occurredAt: txn.txnDate,
    sourceSystem: "api",
    sourceEventKey: `bank.txn.posted:${txn.id}`,
    objectType: "bank_transaction",
    objectId: txn.id,
    details: { reference: txn.reference, counterparty: txn.counterparty, kind: txn.kind },
    deltas: [
      { accountCode: ACCOUNTS.bank, amountMinor: txn.amountMinor, memo: txn.reference },
      { accountCode: params.accountCode, amountMinor: -txn.amountMinor, memo: params.memo },
    ],
    memo: `Bank: ${params.memo} (${txn.reference})`,
    postedBy: params.postedBy,
  });
  await db
    .update(bankTransaction)
    .set({ status: "matched", matchedType: "journal", matchedId: posted.journalId })
    .where(eq(bankTransaction.id, txn.id));
  return { journalId: posted.journalId };
}

/** Apply the deterministic kind-rules to every unmatched line they cover.
 * Idempotent (event source keys); AR receipts and unknown kinds untouched. */
export async function reconcileBankRules(
  db: Db,
  postedBy = "bank-rec-rules",
): Promise<{ posted: number; byKind: Record<string, number> }> {
  const byKind: Record<string, number> = {};
  let posted = 0;
  for (const [kind, rule] of Object.entries(BANK_RULES)) {
    const open = await db.query.bankTransaction.findMany({
      where: (t) => and(eq(t.status, "unmatched"), eq(t.kind, kind)),
    });
    for (const txn of open) {
      await postBankTxn(db, {
        bankTransactionId: txn.id,
        accountCode: rule.accountCode,
        memo: rule.memo,
        postedBy,
      });
      posted++;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
    }
  }
  return { posted, byKind };
}
