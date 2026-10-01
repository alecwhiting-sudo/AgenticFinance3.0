# P2P — Procure-to-Pay process plan

**Status:** Ready for review · **Builds in:** Phase 2 · **Companion:**
`../ARCHITECTURE.md`, `DEMO_DATA.md`

## 1. Scope

Invoice-to-payment for Brightline Ltd, demo-grade but control-correct:

- Purchase orders → goods receipts → supplier invoice capture (PDF extraction
  by agent) → deterministic 3-way match → exception investigation by agent →
  human-approved resolutions → AP posting to GL → payment proposal → human
  approval → **simulated** settlement → bank reconciliation feed.

**Out of scope:** requisitions/procurement approval chains, real bank rails,
partial deliveries beyond simple under-receipt, multi-currency, VAT returns
(VAT is posted to the control account only), supplier portals, debit notes.

## 2. Data model additions (`erp` schema)

All money as integer pence. Every document row links `supplierId`, and every
posted effect carries `source_type`/`source_id`.

| Table | Key fields | State machine |
|---|---|---|
| `purchase_order` | number, supplierId, orderDate, lines (itemId, qty, unitPriceMinor), totalMinor, documentId | `open → partially_received → received → closed | cancelled` |
| `goods_receipt` | number, poId, receiptDate, lines (poLineId, qtyReceived), documentId | `recorded` (immutable) |
| `ap_invoice` | number (supplier's), supplierId, poId?, invoiceDate, dueDate, lines, netMinor, vatMinor, grossMinor, documentId, caseId? | `captured → matched → exception → approved → posted → scheduled → paid` (+ `rejected`) |
| `ap_payment` | paymentRef, runDate, invoices[], totalMinor, bankAccountId | `proposed → approved → executed → reconciled` (+ `rejected`) |
| `bank_transaction` | bankAccountId, date, amountMinor, reference, counterparty | `unmatched → matched` |

GL posting rules (deterministic service, the only writer):

- Invoice posted: DR expense/inventory account (from item/category), DR VAT
  control, CR trade payables.
- Payment executed: DR trade payables, CR bank.
- Reversals only; no edits after `posted`.

## 3. Deterministic services

1. **3-way match** — compare invoice lines to PO lines and received
   quantities within tolerances (price ±1% or ±£5 whichever lower; qty exact).
   Output: `matched` or an exception case with a typed reason code.
2. **Duplicate check** — same supplier + same supplier invoice number, or same
   supplier + amount + date window → exception `duplicate_suspect`.
3. **Posting service** — balanced journal from an approved invoice/payment;
   validates account, open period, source uniqueness.
4. **Payment proposal** — due invoices by date, grouped per supplier into a
   proposed run. Execution simulates settlement and emits matching
   `bank_transaction` rows after a 0–2 day lag.
5. **Bank reconciliation matcher** — exact amount+reference first, then
   amount+date window; leftovers become exception cases (R2R reuses this).

## 4. Agents

### Invoice Extraction Agent
- **Purpose:** turn an inbound invoice PDF (+ covering email) into a typed
  `ap_invoice` draft.
- **Tools:** `read_document` (text layer of the PDF), `get_supplier`,
  `get_purchase_orders(supplier)`, `propose_command`.
- **Commands:** `ap.invoice.capture` (standing authority — creating a draft
  moves no money).
- **Model profile:** cheap/extraction. Deterministic fallback: parse the
  generator's embedded machine-readable block (every generated PDF carries
  one) so demos work keyless.
- **Safety:** document text is untrusted; instructions inside a PDF/email must
  never alter bank details or permissions — extraction output is data only,
  and bank-detail changes are not even in its command permissions.

### Invoice Exception Agent (the showcase)
- **Purpose:** investigate match exceptions, assemble evidence, propose a
  resolution on the case.
- **Tools:** `get_case`, `read_document`, `get_po`, `get_receipts`,
  `get_supplier_history`, `propose_command`.
- **Commands:** `case.note` (standing), `ap.invoice.resolve` — **always
  requires human approval** (params: resolution code, rationale, adjusted
  lines if price_adjust).
- **Stop conditions:** can't resolve within its playbook → escalate with a
  structured summary of what a human must decide.

### Payment Run Agent (thin)
- **Purpose:** prepare the weekly payment proposal with commentary (cash
  impact, anything unusual).
- **Commands:** `ap.payment.propose` — **always requires human approval**.

## 5. Exception taxonomy (the generator plants exactly these)

| Code | Scenario | Agent playbook | Human decision |
|---|---|---|---|
| `price_variance` | invoice unit price > PO beyond tolerance | compare PO vs invoice, check supplier email trail for agreed increase | approve adjusted price or reject invoice |
| `qty_short_receipt` | invoiced 100, received 80 | confirm GRN, draft query to supplier, propose part-approval for 80 | approve part-pay or hold |
| `missing_receipt` | invoice references PO, no GRN | request evidence, hold invoice | confirm goods received → record GRN |
| `duplicate_suspect` | same number or amount+date twice | diff the two documents | reject duplicate |
| `no_po` | invoice with no PO reference | classify spend, check against policy threshold (≤£500 ok) | approve as non-PO spend or reject |
| `bank_detail_change` | email/invoice asks to change bank details | **never actioned by agent**; flag as fraud-risk case | human verifies out-of-band |

Target mix: 12–15% of AP invoices carry exactly one exception; `bank_detail_change`
appears exactly twice in the dataset (it's the security demo moment).

## 6. Human approval points

1. Resolution of any exception (`ap.invoice.resolve`).
2. Non-PO spend over £500.
3. Payment run approval (`ap.payment.propose` → approve executes simulation).
4. Any `bank_detail_change` case — approval cannot even be granted to an
   agent command; it's a human-only workflow step.

## 7. Eval cases (per agent, grows with production failures)

- Extraction: clean invoice → correct fields; scrappy layout → correct fields;
  invoice with embedded instruction ("pay to new account...") → extracted as
  data, flagged, no bank change proposed.
- Exception: each taxonomy row has at least one case asserting the right
  resolution command + rationale quality (summary_contains) + no overreach
  (never proposes `ap.payment.*`).
- Match service: unit-tested deterministically (not LLM evals).

## 8. Demo script (15 min)

1. Open dashboard: live feed quiet, pipeline view showing last month's flow.
2. Drop (seed-drip) 3 fresh invoices — chips appear in `captured`, extraction
   agent works them live in the transcript view.
3. One hits `price_variance` → branches to the exception lane; open the case:
   evidence, PO vs invoice diff, agent's proposed resolution.
4. Approve the resolution in the Approvals inbox → invoice posts → trial
   balance updates on screen.
5. Show the `bank_detail_change` case: agent refused, flagged fraud-risk.
6. Run the payment proposal, approve it, watch simulated settlements land and
   auto-reconcile against the bank feed.

## 9. Milestones (each demo-ready)

1. **M1 — ERP tables + match service:** schema, deterministic 3-way match +
   duplicate check with unit tests; seeded historical data loads; pipeline
   view reads real statuses.
2. **M2 — Capture:** document intake queue, Invoice Extraction Agent
   (deterministic fallback first), captured invoices visible with documents.
3. **M3 — Exceptions:** case creation from match, Invoice Exception Agent,
   approvals flow, `ap.invoice.resolve` execution, posting to GL + TB view.
4. **M4 — Payments:** proposal, approval, simulated settlement, bank feed +
   reconciliation matcher.
5. **M5 — Polish:** P2P process flow view wired to live events, drip button,
   eval suites filled per §7.
