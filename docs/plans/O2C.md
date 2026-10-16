# O2C — Order to Cash (process plan, v1)

Same entry posture as P2P (D13): the module pushes the business event AND its
accounting through the one pipe. Revenue finally lands on the P&L, and the
292 customer receipts parked on the bank feed get applied.

## 1. Scope

In: customer master, AR invoices (billing already rendered by the Studio —
invoice PDFs, contracts, remittance PDFs), revenue posting, cash application
(deterministic + agent), collections (agent-drafted dunning with human
approval). Out (later): sales orders/quotes, credit notes, part-payments,
credit control policies.

## 2. Data model

- `ar_invoice`: number (unique), customer, dates, lines, net/VAT/gross,
  status `issued → posted → paid` (overdue is computed, not stored),
  documentPath/contractPath/remittancePath, journalId, receiptJournalId.
- `ar_dunning`: sent chase letters (invoiceId, text, sentBy, runId).
- Customers upserted from the dataset (60) like suppliers.

## 3. Postings (all through `postEvent`)

| Event | Deltas |
|---|---|
| `ar.invoice.posted` | DR 1100 receivables gross; CR revenue (per line account) net; CR 2200 VAT |
| `ar.receipt.posted` | DR 1000 bank gross; CR 1100 receivables |

Cash application marks the bank line matched and the invoice paid in the
same flow. Idempotent source keys per invoice/receipt.

## 4. Cash application (M2)

Deterministic matcher first (if code can decide it, no model call):
reference equals invoice number AND amount equals gross → apply. The
leftovers go to the **Cash Application Agent**: unique amount match or
reference fuzz → propose `ar.receipt.apply {bankTransactionId, invoiceId,
rationale}` (ALWAYS human-approved); nothing confident → escalate.
Remittance text is untrusted data.

## 5. Collections (M3)

Overdue = posted, unpaid, past due date. "Chase" queues the **Collections
Agent**: drafts a firm-but-courteous dunning letter grounded in the real
invoice facts (number, amount, days overdue, terms) and proposes
`ar.dunning.send {invoiceId, text}` — ALWAYS human-approved (external
communication, finance safety rule). Execution records the letter in
`ar_dunning` (send is simulated) and notes the case trail. Keyless fallback:
templated letter from the payload facts.

## 6. Agents

| Agent | Profile | Authority |
|---|---|---|
| Cash Application Agent | `default` | proposes `ar.receipt.apply` (human-approved); `case.note` |
| Collections Agent | `default` | proposes `ar.dunning.send` (human-approved); `case.note` |

## 7. Milestones

1. **M1 — Revenue live:** schema + migration; loader upserts customers,
   posts all 400 AR invoices through the pipe; paid ones get receipts
   applied against their bank lines at load. P&L shows income.
2. **M2 — Cash application:** matcher service + apply command/executor +
   Cash Application Agent (handler, fallback, seed, evals); R2R bank card
   reflects applied receipts.
3. **M3 — Collections + UI:** /o2c dashboard (pipeline, AR aging, overdue
   list with Chase), customer pages, Collections Agent + `ar.dunning.send`;
   evals; end-to-end verify.

## 8. Demo beats

1. Reports: the P&L now has revenue; drill a revenue number → ledger →
   journal → AR invoice → its PDF.
2. Bank feed: "Apply receipts" clears hundreds of lines deterministically;
   an odd remittance goes to the Cash Application Agent → approval → applied.
3. An overdue invoice → Chase → Collections Agent's letter in the approvals
   inbox → approve → recorded as sent.

## 9. Backlog — receipt/dispute exception management (Alec, 2026-10-03)

Mirror of plans/P2P.md §10 for the AR side. **First slice BUILT 2026-10-10:**
the Cash Application Agent opens an `ar_receipt` evidence case (new
display-only `case.open` command) for unmatched, ambiguous and over/part
payments, with grounded options — apply-with-residual to the closest larger
invoice (residual costed), refund-or-hold for overpayments, hold-and-query
with a draft remittance-request letter (display-only, never sent) — shown
on /o2c as "Receipt queries". Applying money stays human via
ar.receipt.apply. **Dispute mirror BUILT 2026-10-16:** "Dispute" on any
posted AR invoice (O2C pages) takes the customer's stated reason and
queues an `ar.dispute` task; the Collections Agent opens an `ar_dispute`
case with the invoice facts and grounded ways forward — hold chasing
(hold_dunning), re-issue corrected (reissue_invoice, with a display-only
draft reply), credit the disputed amount (issue_credit) — and ALWAYS
escalates: crediting or re-billing is a human decision. The one automatic
effect is deterministic and in code: `/o2c/chase` refuses a disputed
invoice (dunning held while the case is open), and the workbench shows
"disputed — dunning held" in place of the Chase button. Disputes surface
on /o2c beside Receipt queries. Remaining: ground disputes in contract
documents once a contracts register exists.
