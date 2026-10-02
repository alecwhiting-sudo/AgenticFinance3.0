/** Payment scheduler + bank reconciliation (plans/P2P.md M4). Deterministic:
 * spend was approved at intent (D12), so the run itself is informational —
 * but executing it moves money, which is always a human checkpoint
 * (CLAUDE.md finance safety rule). */
import { and, eq } from "drizzle-orm";
import { apInvoice, apPayment, bankTransaction, type Db } from "@af/db";
import { executeApPayment } from "./posting.js";

/** Pure: pick posted invoices due on or before the horizon. */
export function selectDueInvoices<T extends { status: string; dueDate: string }>(
  invoices: T[],
  runDate: string,
  horizonDays = 7,
): T[] {
  const horizon = new Date(runDate);
  horizon.setDate(horizon.getDate() + horizonDays);
  const cutoff = horizon.toISOString().slice(0, 10);
  return invoices.filter((i) => i.status === "posted" && i.dueDate <= cutoff);
}

/** Pure: a bank txn matches a payment when reference and amount line up.
 * Bank amount is negative (money out); payment total is positive. */
export function bankTxnMatchesPayment(
  txn: { reference: string; amountMinor: number; kind: string },
  payment: { paymentRef: string; totalMinor: number },
): boolean {
  return (
    txn.kind === "ap_payment" &&
    (txn.reference === payment.paymentRef || `PAY-${txn.reference}` === payment.paymentRef) &&
    -txn.amountMinor === payment.totalMinor
  );
}

/** Group due posted invoices into one proposed run; invoices move to
 * `scheduled`. Returns null when nothing is due. */
export async function proposePaymentRun(
  db: Db,
  runDate: string,
): Promise<typeof apPayment.$inferSelect | null> {
  const posted = await db.query.apInvoice.findMany({ where: (t) => eq(t.status, "posted") });
  const due = selectDueInvoices(posted, runDate);
  if (due.length === 0) return null;

  const totalMinor = due.reduce((n, i) => n + i.grossMinor, 0);
  const ref = `RUN-${runDate}-${String(Date.now() % 100000).padStart(5, "0")}`;
  const [run] = await db
    .insert(apPayment)
    .values({
      paymentRef: ref,
      runDate,
      invoiceIds: due.map((i) => i.id),
      totalMinor,
      status: "proposed",
    })
    .returning();
  for (const i of due)
    await db.update(apInvoice).set({ status: "scheduled" }).where(eq(apInvoice.id, i.id));
  return run!;
}

/** Human decision on a proposed run. Approval executes it: posts the
 * settlement journal (bank out), lands a simulated bank transaction, and
 * reconciles it against the run. Rejection returns invoices to `posted`. */
export async function decidePaymentRun(
  db: Db,
  paymentId: string,
  approve: boolean,
  decidedBy: string,
): Promise<{ status: string; journalId?: string }> {
  const run = await db.query.apPayment.findFirst({ where: (t) => eq(t.id, paymentId) });
  if (!run) throw Object.assign(new Error("payment run not found"), { statusCode: 404 });
  if (run.status !== "proposed")
    throw Object.assign(new Error(`run is ${run.status}, not proposed`), { statusCode: 409 });

  if (!approve) {
    await db.update(apPayment).set({ status: "rejected" }).where(eq(apPayment.id, run.id));
    for (const invId of run.invoiceIds)
      await db.update(apInvoice).set({ status: "posted" }).where(eq(apInvoice.id, invId));
    return { status: "rejected" };
  }

  const { journalId } = await executeApPayment(db, run.id, decidedBy);
  // Simulated settlement: the "bank" clears the run same-day.
  await db.insert(bankTransaction).values({
    txnDate: run.runDate,
    amountMinor: -run.totalMinor,
    reference: run.paymentRef,
    counterparty: "Brightline current account",
    kind: "ap_payment",
    status: "unmatched",
  });
  const { matched } = await reconcileBank(db);
  return { status: matched > 0 ? "reconciled" : "executed", journalId };
}

/** Match unmatched ap_payment bank lines to executed runs by ref + amount. */
export async function reconcileBank(db: Db): Promise<{ scanned: number; matched: number }> {
  const open = await db.query.bankTransaction.findMany({
    where: (t) => and(eq(t.status, "unmatched"), eq(t.kind, "ap_payment")),
  });
  const candidates = await db.query.apPayment.findMany({
    where: (t) => eq(t.status, "executed"),
  });
  let matched = 0;
  for (const txn of open) {
    const pay = candidates.find((p) => bankTxnMatchesPayment(txn, p));
    if (!pay) continue;
    await db
      .update(bankTransaction)
      .set({ status: "matched", matchedType: "ap_payment", matchedId: pay.id })
      .where(eq(bankTransaction.id, txn.id));
    await db.update(apPayment).set({ status: "reconciled" }).where(eq(apPayment.id, pay.id));
    candidates.splice(candidates.indexOf(pay), 1);
    matched++;
  }
  return { scanned: open.length, matched };
}
