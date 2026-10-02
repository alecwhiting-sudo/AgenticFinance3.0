# R2R — Record to Report (process plan, v1)

**Scope decision (Alec, 2026-10-02):** LRS lock / certify / restatement is
**deferred** — it slots into the month-end dashboard later as one new action
plus the snapshot tables (D13; `analysis/finance-data-platform.md` §7 step 3).
This plan covers everything else. All postings flow through the FDP pipe
(`fdpPost.postEvent`): deterministic rules and services attach account-coded
deltas; the accrual engine derives deltas from bare events + versioned
parameters (the second entry posture, proven here).

## 1. What R2R is in this system

The module that keeps the books *complete and explained* each month:
reconcile the bank, post the recurring and accrual entries, produce the
statements, and draft the story of the month. Agents investigate and draft;
deterministic code posts; humans approve anything judgemental.

## 2. Bank reconciliation (M1)

The bank feed holds four unmatched kinds after P2P's AP matcher runs:

| kind | treatment |
|---|---|
| `salaries` | deterministic rule: DR 6000 Salaries, CR 1000 Bank — post + match |
| `vat` | deterministic rule: DR 2200 VAT control, CR 1000 Bank — post + match |
| `bank_fees` | deterministic rule: DR 6900 Sundry (memo "Bank charges"), CR 1000 Bank — post + match |
| `ar_receipt` | **deferred to O2C** (needs the AR subledger for cash application); categorised and visible, agent abstains |

- Rules run via `reconcileBank` extension; each posting is an FDP event
  (`bank.txn.posted`, source key = bank txn id) — idempotent, replayable.
- Ambiguous lines (unknown kind, odd amounts) go to the **Reconciliation
  Agent**: investigates (bank line + similar history + chart of accounts),
  proposes `bank.txn.post {bankTransactionId, accountCode, rationale}` —
  **requiresApproval: true** (judgement call → human inbox). Executor builds
  the balanced journal through the pipe and marks the line matched.
- Keyless fallback playbook: apply the kind-rules table; abstain on
  `ar_receipt` ("needs AR subledger — lands with O2C") and unknowns.

## 3. Accruals, prepayments, recurring journals (M2)

First **measurement transformation**: events arrive *without* deltas; the
engine derives them from a versioned `fdp.parameter_set` (immutable once
active). Seeded parameters (Brightline-sized):

- **Prepayment release:** annual insurance £2,988 paid in advance, released
  £249/month — DR 6100, CR 1500 Prepayments.
- **Accrual:** cleaning services ~£420/month accrued (invoice arrives late)
  — DR 6100, CR 2100 Accruals; auto-reverses next month.
- **Recurring journal:** office rent £1,800/month — DR 6100, CR 2100 (paid
  via bank feed later; demo keeps it simple).

Mechanics: "Run month-end postings" (per period) emits one
`period.tick {periodCode}` event per schedule entry with `deltas: null`;
`deriveDeltas(event, parameterSet)` computes them; the same pipe posts.
Idempotent per (schedule, period) via source key. Deterministic code — the
`none` model tier, no model call.

## 4. Financial statements (M3)

- API: `GET /erp/statements?year=` → monthly P&L (income/expense accounts by
  month from journal lines) and balance sheet at each month end, plus YTD.
- Web: `/reports` — P&L and balance sheet, month columns, every number
  drills to `/ledger/[code]`. Reports state their basis ("Live" — until LRS
  arrives, everything is live state).
- `/r2r` month-end dashboard: period selector; reconciliation status
  (matched/unmatched by kind, ar_receipt shown as "awaiting O2C");
  month-end postings run state; open exceptions; checklist feel. The lock /
  certify button lands here later.

## 5. Close Agent commentary (M4)

- **Close Agent** (modelProfile `default`): given the statements for a
  period, drafts flux/variance commentary (what moved, why, what to watch),
  grounded in the numbers via tools (`get_statements`, `get_account_detail`)
  — never invents figures. Output saved as a draft `report_commentary` row
  (period, text, runId); shown on `/reports` marked **Draft — agent**, human
  can regenerate. Publishing externally would be an approval; an on-screen
  draft is not.
- Deterministic fallback: templated commentary from the biggest absolute and
  percentage movements.
- Evals: clean month → mentions top movers with correct figures; flat month
  → says so without invention; a prompt-injection line item in data →
  treated as data (summary_contains checks).

## 6. Agents

| Agent | Profile | Authority |
|---|---|---|
| Reconciliation Agent | `default` | proposes `bank.txn.post` (human-approved); `case.note` standing |
| Close Agent | `default` | drafts commentary only; no posting permissions |

Rules carried over: deterministic rules always run before any agent sees a
work item (if code can decide it, no model call); bank-detail or
payment-looking asks are out of both agents' remit.

## 7. Milestones

1. **M1 — Bank reconciliation complete:** kind-rules post salaries/VAT/fees
   through the pipe; `bank.txn.post` command + executor; Reconciliation
   Agent (handler, fallback, seed, evals); payments page shows categories.
2. **M2 — Month-end postings:** parameter_set seeds; derive-deltas engine
   branch; period.tick runner + idempotency; unit tests incl. derivation.
3. **M3 — Statements + dashboard:** statements API; /reports (P&L, BS,
   drillable); /r2r month-end dashboard with run button + rec status.
4. **M4 — Close Agent:** commentary generation + fallback + evals; shown on
   /reports; end-to-end verify.
5. **M5 (deferred) — LRS:** lock/certify/supersede + reconciliation gates —
   see D13 strangler step 3.

## 8. Demo script (8 min)

1. Open `/r2r`: bank shows salaries/VAT/fees unmatched → **Reconcile** →
   they post and match live; AR receipts sit labelled "awaiting O2C".
2. An odd bank line → Reconciliation Agent investigates → proposal in the
   approvals inbox with rationale → approve → posted, matched.
3. **Run month-end** → prepayment release, accrual + reversal, rent land as
   events through the same pipe (show the journals).
4. `/reports`: P&L with month columns; click a number → account → journal →
   source. Close Agent's draft commentary alongside; regenerate it live.

## 9. Backlog (noted 2026-10-02)

- **Commentary quality (Alec):** first live drafts are too basic to be worth
  reading. Develop the Close Agent's skills: richer structure (headline,
  revenue vs cost split, margin movement, MoM and YTD views, driver
  attribution by drilling movements/events, materiality thresholds so trivia
  is omitted), tone calibrated to a board pack, and eval cases that fail
  bland output (assert specific drivers and figures are named, not just "X
  went up"). Candidates: give the agent tools to pull prior commentary and
  account detail; consider the `reasoning` tier for this task only if evals
  show the default tier can't reach the bar (eval before promote, per
  CLAUDE.md model routing).
