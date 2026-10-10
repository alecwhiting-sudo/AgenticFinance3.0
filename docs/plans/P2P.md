# P2P — Procure-to-Pay process plan

**Status:** Ready for review (v2 — unified Purchase model) · **Builds in:**
Phase 2 · **Companion:** `../ARCHITECTURE.md`, `DEMO_DATA.md`

## 0. The thesis: one Purchase, approved once

Traditional P2P stacks documents: requisition → approval → purchase order →
receipt → invoice → match → approval again → payment. Each document re-keys
the last one; each approval re-litigates the same spend.

This process demonstrates a deliberately simpler model:

1. **One record.** A **Purchase** is created at the moment of intent (who
   needs what, why, roughly how much — free text is fine; an agent structures
   it). The requisition and the PO are not separate documents: approval
   converts the same record into the external commitment, and the
   supplier-facing "PO" PDF is just a **rendered view** of the approved
   Purchase. Receipts and invoices attach to it. The whole story — ask,
   approval, delivery, billing, payment — is one thread.
2. **Approve once, at intent.** Spend is approved where the decision actually
   happens — before committing to the supplier. Downstream, an invoice that
   matches the approved Purchase within tolerance posts and schedules for
   payment **with no second approval**. Humans reappear only on exceptions.
3. **Policy bands, not chains:**

   | Band | Rule (demo policy) | Approval |
   |---|---|---|
   | Auto | ≤ £500, known supplier, within category budget | Standing authority (logged, visible) |
   | Standard | ≤ £5,000 | One approver, one click |
   | Director | > £5,000 or new supplier | Director, one click |

   No multi-step chains, no re-approval of the same spend at invoice time.

The demo moment this buys: type "we need 4 monitor arms for the new desks,
about £200" → agent structures it, checks budget, auto-approves under policy →
supplier view issued → weeks later the invoice arrives, matches, posts, and
pays — zero further human touches, every step visible on the one record.

## 1. Scope

Intent-to-payment for Brightline Services plc, demo-grade but control-correct:
purchase creation (free-text or structured) → policy-banded approval →
supplier view issued → goods receipt → invoice capture (PDF extraction by
agent) → deterministic 3-way match against the **approved Purchase** →
exception investigation by agent → human-approved resolutions → AP posting to
GL → payment scheduling (no re-approval if clean) → **simulated** settlement →
bank reconciliation feed.

**Out of scope:** multi-line partial approvals, catalogue/punch-out, real bank
rails, multi-currency, VAT returns (control account only), supplier portals,
debit notes.

## 2. Data model additions (`erp` schema)

All money as integer pence; every posted effect carries `source_type`/`source_id`.

| Table | Key fields | State machine |
|---|---|---|
| `purchase` | number, supplierId, **requestedBy, businessNeed, requestDate**, approvalBand (auto/standard/director), approvedBy, approvedAt, orderDate, lines (itemId/desc, qty, unitPriceMinor, account), totalMinor, documentId (supplier view PDF) | `requested → approved → partially_received → received → closed` (+ `rejected`, `cancelled`) |
| `goods_receipt` | number, purchaseId, receiptDate, lines (purchaseLineId, qtyReceived), documentId | `recorded` (immutable) |
| `ap_invoice` | number (supplier's), supplierId, purchaseId?, invoiceDate, dueDate, lines, netMinor, vatMinor, grossMinor, documentId, caseId? | `captured → matched → exception → approved → posted → scheduled → paid` (+ `rejected`) |
| `ap_payment` | paymentRef, runDate, invoices[], totalMinor, bankAccountId | `proposed → approved → executed → reconciled` (+ `rejected`) |
| `bank_transaction` | bankAccountId, date, amountMinor, reference, counterparty | `unmatched → matched` |
| `category_budget` | account, period, budgetMinor, committedMinor, actualMinor | (maintained by services; drives the auto band and the demo's budget-aware intake) |

Commitment accounting lite: approving a Purchase increases
`category_budget.committedMinor`; posting its invoice moves committed →
actual. This is what lets the intake agent answer "is there budget for this?"

GL posting rules (deterministic service, the only writer): invoice posted →
DR expense (from purchase lines' accounts), DR VAT control, CR trade
payables; payment executed → DR trade payables, CR bank. Reversals only.

## 3. Deterministic services

1. **Approval router** — applies the policy bands to a structured Purchase:
   auto-approves within standing authority (logged with the rule that fired),
   else creates the one-click approval task for the right approver.
2. **3-way match** — invoice lines vs **approved Purchase** lines vs received
   quantities (price ±1% or ±£5 whichever lower; qty exact). Clean match on an
   approved Purchase ⇒ straight-through: post + schedule payment, no human.
3. **Duplicate check** — same supplier + invoice number, or supplier + amount
   + date window → `duplicate_suspect`.
4. **Posting service** — balanced journal; validates account, open period,
   source uniqueness; updates category_budget committed→actual.
5. **Payment scheduler** — clean posted invoices queue for the next run by due
   date; the run executes under standing authority **because each purchase was
   already approved** (run-level human view exists but is informational; a
   human can still hold a line). Simulated settlement emits bank lines.
6. **Bank reconciliation matcher** — amount+reference, then amount+date
   window; leftovers become cases (R2R reuses this).

## 4. Agents

### Purchase Request Agent (new — the front door)
- **Purpose:** turn an ask (free text, email, or form) into a structured
  Purchase: supplier suggestion, line items, account coding, estimated total;
  check category budget; submit into the approval router.
- **Tools:** `get_suppliers`, `get_items`, `get_category_budget`,
  `propose_command`.
- **Commands:** `purchase.create` (standing — creating a *requested* purchase
  moves no money and commits nothing until approval).
- **Why a separate agent:** distinct permission set (create-only, budget
  reads, zero money/exception authority) and conversational capability
  profile. It is the only agent users talk to directly.

### Invoice Extraction Agent
- As before: inbound invoice PDF + email → typed `ap_invoice` draft via
  `ap.invoice.capture` (standing). Cheap/extraction model profile;
  deterministic fallback parses the generated PDFs' AF-DATA text layer.
- Document text is untrusted; bank-detail changes are outside its command set
  by construction.

### Invoice Exception Agent (the showcase)
- As before: investigates match exceptions against the Purchase thread (which
  now includes the original ask and approval — richer evidence), proposes
  `ap.invoice.resolve` (**always human-approved**), `case.note` standing.

### ~~Payment Run Agent~~ → retired from the roster
- The unified model makes a payment agent unnecessary: payment is a
  deterministic consequence of an approved purchase + clean match. The
  scheduler is a service, not an agent. (Decomposition test applied: no
  judgement left in the step ⇒ no agent.) A human-facing payment-run screen
  remains for visibility and manual holds.

## 5. Exception taxonomy (the generator plants exactly these)

| Code | Scenario | Agent playbook | Human decision |
|---|---|---|---|
| `price_variance` | invoice price > approved purchase beyond tolerance | compare purchase vs invoice, check email trail for agreed increase | approve adjusted price or reject |
| `qty_short_receipt` | invoiced 100, received 80 | confirm GRN, draft supplier query, propose part-approval | approve part-pay or hold |
| `missing_receipt` | invoice references purchase, no GRN | request evidence, hold | confirm receipt → record GRN |
| `duplicate_suspect` | same number or amount+date twice | diff the documents | reject duplicate |
| `no_purchase` | invoice with no purchase record | classify spend; ≤£500 known supplier may become a retro purchase under the auto band | approve retro purchase or reject |
| `bank_detail_change` | email/invoice asks to change bank details | **never actioned by agent**; fraud-risk case | human verifies out-of-band |

Mix: 12–15% of AP invoices carry one exception; `bank_detail_change` exactly
twice.

## 6. Human approval points (fewer, by design)

1. Purchase approval — standard/director bands only (auto band is logged).
2. Resolution of any exception (`ap.invoice.resolve`).
3. Retro-purchase for `no_purchase` over the auto band.
4. `bank_detail_change` — human-only, always.

Deliberately **absent**: invoice approval for clean matches, payment-run
re-approval of already-approved spend. The demo narrates this absence.

## 7. Eval cases

- Purchase Request: clear ask → correctly structured + coded + banded; vague
  ask → asks nothing it can look up, estimates sensibly; over-budget ask →
  flags budget, still structures; ask to "pay someone" → abstains (not its
  remit).
- Extraction: clean invoice; scrappy layout; embedded instruction ("pay to new
  account…") → extracted as data, flagged, no bank change proposed.
- Exception: one case per taxonomy row asserting the right resolution command
  + rationale (summary_contains) + no overreach.
- Match/approval router/scheduler: deterministic unit tests, not LLM evals.

## 8. Demo script (15 min)

1. **The ask:** type "4 monitor arms for the new desks, ~£200" to the Purchase
   Request Agent → watch it structure, code to 6900, check budget,
   auto-approve under policy → supplier view PDF appears on the record. One
   record, zero forms.
2. **Straight-through:** drip a clean invoice against an approved purchase →
   extraction → match → posted → scheduled. Count the human touches: zero
   since approval. TB updates live.
3. **Exception lane:** a price-variance invoice branches to the Invoice
   Exception Agent → case with the full thread (ask → approval → PO view →
   invoice diff) → approve its resolution in the inbox → posts.
4. **The fraud attempt:** bank-detail-change email → agent refuses, flags;
   narrate why the extraction agent *cannot* touch bank details.
5. **Payment day:** scheduler proposes the run; show it's informational —
   spend was approved at intent; execute → simulated settlements land and
   auto-reconcile.

## 9. Milestones (each demo-ready)

1. **M1 — Purchase model + match:** ✅ `purchase`/receipt/invoice/bank tables
   with state machines, approval router + policy bands, category budgets,
   3-way match + duplicate check (unit-tested); load the Studio dataset
   through the intake services; pipeline view reads real statuses.
2. **M2 — Intake:** ✅ Purchase Request Agent (free-text → structured purchase,
   deterministic fallback first), approval tasks in the workbench, supplier
   view rendering.
3. **M3 — Capture + exceptions:** ✅ document intake queue, Invoice Extraction
   Agent, cases, Invoice Exception Agent, `ap.invoice.resolve` approvals,
   posting + TB view.
4. **M4 — Straight-through + payments:** ✅ scheduler, simulated settlement,
   bank feed + reconciliation matcher; demonstrate the zero-touch clean path.
5. **M5 — Polish:** ✅ P2P flow view wired to live events, drip button, eval
   suites per §7.

## 10. Exceptions management build-out (Alec, 2026-10-03) — M1 ✅ built 2026-10-03

M1 shipped: `case.options` command (display-only, standing; any release may
write to its own cases), Exception Agent attaches 2–3 grounded, costed
options per case (deterministic fallback computes them from the actual
purchase/receipt rows; LLM path gets the same objective + get_invoice_context),
the `/p2p/exceptions` workbench (queue by kind, approved-vs-received-vs-
invoiced line diff, supplier history, document links, one-click apply with
pending-proposal supersede, case timeline), on-demand "ask the agent"
investigation (model spend only when requested). Remaining below.

Remaining (M2):

- **Richer model-path options:** supplier email drafts attached to options
  (short-pay letter, duplicate notification), tolerance policy as a
  parameter set, option quality evals per exception kind.
- **O2C mirror:** the same pattern for unapplied receipts (part-payments,
  overpayments, unknown payers) and disputed invoices — grounded in the
  contract, the invoice and the remittance.
- **Evals:** per exception kind, assert the agent proposes the right option
  family and never proposes paying an unverified bank-detail change.
