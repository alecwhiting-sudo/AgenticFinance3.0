# Analysis: replacing the "mini ERP" with a Finance Data Platform (FDP)

**Status:** analysis only — no plans amended, nothing implemented.
**Source material:** the OpenFinance POC (PRD v2.0, schema `db/001_schema.sql`,
engine + persistence code, Feb-2025 enhancement log), read in full.
**Decision pending:** adopt, adapt, or decline; then update MASTER_PLAN /
ARCHITECTURE as a second step.

---

## 1. The idea in one paragraph

Stop thinking "mini ERP with modules". Think **a finance data platform**: an
append-only **event store** is the sole source of economic truth; a small
**deterministic engine** turns each event into explicit **deltas** via a typed
contract; deltas land simultaneously as an immutable **movement ledger**, an
updated **live state** (LES), and a balanced **double-entry journal**; a
**close** is a physical snapshot (LRS) that governance locks and certifies —
never a recalculation. GL-grade controls (double entry, trial balance,
idempotency, journal approvals, immutability, replay) are properties of the
data platform, not features of an ERP application. OpenFinance proved this
shape end-to-end for insurance; everything insurance-specific (IFRS 17, PAA,
LRC/LIC, actuarial assumption sets) strips away cleanly and what remains is a
general finance data store **that also does accounting**.

## 2. What OpenFinance actually contains (distilled, de-insuranced)

### 2.1 Event-native core
- **Append-only event store** — immutable rows, `UNIQUE (source_system,
  source_event_key)` for idempotency, UTC `occurred_at` + `ingested_at`,
  structured JSONB details, `processing_status` (Pending/Processed/Failed).
  DB triggers reject UPDATE/DELETE except the status column.
- **Events are the sole trigger of economic change.** Corrections are new
  compensating events, never edits. Late events are allowed, visible, and
  handled by restatement governance — not silent rewrites.

### 2.2 Deterministic engine + EngineResult contract
- Engine never writes to the database. It emits a frozen, typed
  **EngineResult**: traceability metadata (`event_id`, `engine_version_id`,
  config/assumption version, processed_at) + **explicit delta fields only** —
  no recalculated totals, ever. One validated function
  (`apply_engine_result`) is the single point of mutation.
- Two processing classes: **direct economic mapping** (event data fully
  determines the deltas — most of our P2P/O2C traffic) and **measurement
  transformation** (pattern logic over versioned parameters — accrual
  release, amortisation, revenue earning curves). Same contract either way.
- Determinism guarantee: same event + same prior state + same engine version
  + same parameter set ⇒ identical output. This is what makes **replay** an
  audit capability: rebuild all balances from zero + event history.

### 2.3 Live Economic State (LES) + movement ledger
- **LES**: one row per atomic economic object holding cumulative balances,
  updated only by applying deltas. Never frozen, never manually edited.
- **Movement ledger**: one immutable delta row per (event, object) pair with
  full traceability. Core invariant, checked and enforceable:
  `sum(movement deltas) = current LES balance`, per object and overall.
- **No early aggregation** in authoritative state — roll-ups are derived
  views. This is what buys "with/without" analysis (exclude one big invoice,
  one supplier, one fat-tail case) with zero recalculation.

### 2.4 Journals as representation, not as the store
- Every movement produces a balanced double-entry journal; LES components and
  journal lines must reconcile exactly (mismatch = architectural failure).
- **Two journal classes**: **SDJ** (system-determined, continuous, automatic,
  from controlled event processing) and **GOJ** (governance overlay: rare,
  human-triggered, requires a `governance_reference_id`, approval workflow,
  reversal support, templates). The Feb-2025 log adds practical GOJ features
  worth keeping: lookup-and-negate reversals pinned to the original event's
  period, portfolio-level splits, and journal templates.
- DB-level enforcement: non-negative debit/credit, one-side-only per line,
  immutability triggers on journal lines. (Honest note: the balance trigger
  in the POC is a stub — balance is checked app-side pre-commit. We'd do it
  properly with a deferred constraint trigger.)

### 2.5 Close model: LES → LRS (lock ≠ recalculate)
- **Lock** = one `INSERT…SELECT` copying live balances into snapshot rows,
  one per object, per `(close_label, version_number)`. O(objects), instant.
- **Certify** = governance approval that makes that version immutable and
  "decision-ready". A partial unique index enforces **one CERTIFIED version
  per close_label**. Late event after certify ⇒ new version v2, certify,
  mark v1 SUPERSEDED — stored forever, never edited.
- Movement rows carry a lifecycle (`LES → LOCKED → CERTIFIED`), giving
  auditors a row-level view of exactly which movements back certified
  numbers. Income statement periods = close-to-close YTD deltas; no period
  tables.
- Every report must state its basis: LES (live) or LRS (draft / locked /
  certified + version). "Only certified is decision-ready."

### 2.6 Control framework
- Reconciliation runs (movements ↔ LES ↔ journals), exceptions table with
  retry (idempotency makes retry safe), governance log, and hard invariants
  that **block certification** when any reconciliation fails.
- Versioned parameter sets ("assumption sets" in insurance; for us: accrual
  patterns, FX tables, depreciation schedules, recognition policies) that
  are immutable once approved and referenced by every movement.

## 3. What we already have vs. what's genuinely new

AgenticFinance's Phase 2 GL is closer to this than a classic ERP — but the
root of truth is inverted.

| Concept | OpenFinance | AgenticFinance today | Verdict |
|---|---|---|---|
| Root of truth | Event store | Service calls mutate ERP tables | **New** — biggest shift |
| Idempotency | `(source_system, source_event_key)` on events | idempotency key on commands; `(source_type, source_id)` unique on journals | Partial — move it to the event boundary |
| Journals | Immutable, DB-triggered, SDJ/GOJ classed | Append-only by convention, balance checked in app code | Harden: triggers + class column |
| Movement ledger | Immutable deltas per event/object | None (journal lines approximate it) | **New** |
| Live state | LES per policy | Derived trial balance per account | **New** — balances per economic object |
| Close / certify | Lock→Certify→Supersede, versioned snapshots | Nothing (fiscal periods exist, unused for close) | **New** — this *becomes* our R2R phase |
| Human approvals | GOJ workflow + certification | Command gateway `requiresApproval` + approvals inbox | **Strong fit** — same concept, keep ours |
| Determinism | Engine version + parameter set on every row | Deterministic services, versioned agent releases | Fit — add engine/config versioning to postings |
| Replay | Rebuild LES from events | Loader can rebuild from dataset (ad hoc) | Formalise as a first-class control |

The *governance* mapping is the elegant part: our **command gateway is
already the GOJ ingress** (human-approved interventions with full audit
trail), and our **deterministic services are already the SDJ generators**.
OpenFinance supplies the missing substrate those should sit on.

## 4. How the concept transfers (insurance → small-business finance)

Two adaptations are required; the rest ports verbatim.

**Grain.** OpenFinance's atomic object is the policy. Ours is the
**economic object**: purchase, AP invoice, payment run, AR invoice, bank
transaction — exactly the records P2P already produces. LES becomes "live
balances per account × economic object", which is simultaneously the GL
(sum over objects) and the subledger (filter by object). Open-item truths we
currently derive from status fields ("what's unpaid?") become balance
queries ("objects where payables balance ≠ 0").

**Delta vocabulary.** Insurance deltas (LRC, LIC…) are replaced by a
delta-per-account-code model: an EngineResult carries explicit
`(account_code, delta_minor)` pairs plus object references, rather than a
fixed field list. Fixed fields were right for one insurance product; a
general platform needs the chart of accounts as the dimension. The journal
mapping table (delta field → debit/credit account) collapses away because
deltas are already account-coded; sign conventions per account type do the
debit/credit split (we already post this way).

Events for our domain fall out of what the drip/loader already simulates:
`PurchaseApproved`, `GoodsReceived`, `InvoiceCaptured`, `InvoiceResolved`,
`PaymentExecuted`, `BankTransactionReceived`, `AccrualReleased` (the one
true "measurement transformation" we'd ship first — earning/accrual patterns
over time), `GovernanceAdjustment`. Today these exist as activity-feed
entries and service calls; the change is making them the **inputs** instead
of the narration.

**Deliberate divergence from OpenFinance:** it has no operational workflow —
events arrive from outside. We keep our operational layer (purchases,
matching, cases, approvals, agents) **in front of** the event store: a
service like `resolveInvoiceException` stops writing journals itself and
instead emits events; the platform turns events into movements + journals.
CLAUDE.md's "API is the only writer to ERP tables" sharpens into "the
persistence layer applying validated EngineResults is the only writer to
economic state."

## 5. What this does for the agent story (why it's worth it)

1. **Agents get a cleaner action surface.** Today agents propose commands
   that call services that mutate tables. On FDP, agents propose **events**.
   The gateway stays exactly as is (schema + permission + idempotency +
   human checkpoint); what's gated becomes a smaller, fully auditable thing.
   SDJ/GOJ gives us a crisp answer to "what did the machines do vs. what did
   humans override?" — one query, CFO-ready.
2. **Live vs. certified is the control story clients ask about.** "Agents
   continuously maintain the live state; humans certify the reporting state"
   is a stronger pitch than "agents post to an ERP". The close stops being a
   future R2R module and becomes a governance ceremony over data that
   already exists — demo: lock, certify, drip a late invoice, restate to v2
   with v1 preserved.
3. **Replay is an eval harness for the whole finance function.** Determinism
   + event history means we can re-run the entire economic history under a
   new engine version and diff the balances — regression testing for
   accounting logic, same philosophy as our agent eval suites.
4. **Drill-down gets its missing layer.** Current path: TB → account →
   journal → source document. FDP path: TB → account → object → **movement →
   event** → document/agent run. Every number traceable to "what happened,
   who/what processed it, under which engine version" — the audit-grade
   story, now also an agent-observability story.

## 6. What we would *not* take (now)

- IFRS 17 / PAA measurement, LRC/LIC/acquisition-asset mechanics, actuarial
  assumption semantics (the *versioned parameter set* mechanism stays).
- Fixed-field EngineResult (account-coded deltas instead, §4).
- Python engine — ours stays TypeScript in `apps/api`; it's the contract and
  invariants that matter, not the language.
- OpenFinance's thin frontend (our workbench is far ahead).
- Its known soft spot, fixed rather than inherited: journal balance
  enforcement as a real deferred DB constraint, not an app-side check.

## 7. Strategy impact (if adopted) — for the second step

- **New decision D13** in ARCHITECTURE.md: *"Economic state is event-native
  (FDP), not an ERP emulation"* — defining event store, EngineResult,
  movement ledger, LES/LRS, SDJ/GOJ, and the invariants (no movement without
  event; no journal without movement; movements = balances; certified is
  immutable; replay must reproduce state).
- **MASTER_PLAN reshaping:** "Mini ERP core" reframes as "FDP core".
  **R2R largely stops being a module and becomes the close lifecycle**
  (lock, certify, restate, reconciliation gates) plus accrual/prepayment
  patterns as the first measurement transformation. O2C and Performance
  Management land on the platform as new event types + views, not new
  schemas.
- **Migration is strangler, not rewrite** (keeps every demo working):
  - *Step 1 — substrate:* add `fdp` schema (events, movements, engine
    versions, parameter sets) and the EngineResult contract; posting
    service starts consuming events and writing movements + journals
    together; existing API shapes unchanged.
  - *Step 2 — inversion:* P2P services emit events instead of posting
    directly; LES views replace derived status aggregation; DB triggers for
    immutability + deferred balance constraint; replay command + invariant
    checks wired into evals.
  - *Step 3 — governance:* close lifecycle (lock/certify/supersede UI in
    the workbench, certification as an approvals-inbox item), movement
    status lifecycle, reconciliation runs blocking certification; retire
    the "ERP" framing from docs and UI copy.
- **Unchanged:** command gateway, agent framework/releases/evals, Demo Data
  Studio (its dataset becomes an *event* stream — arguably simpler), the
  workbench, Railway deployment, model routing (the engine is deterministic
  code: `none` profile, no model calls — the cheapest tier of all).

## 8. Risks and open questions

- **Volume/perf:** movement ledger grows linearly with events; fine at our
  scale (OpenFinance targets 50k policies comfortably on vanilla Postgres).
- **Ordering & late events:** deterministic order = `occurred_at` then
  `ingested_at`; we must define replay semantics before building (the PRD is
  firm on this; the POC partially dodges it).
- **Dual-write window during Step 1–2** is the main migration hazard: keep
  it short, reconcile continuously, and gate Step 2 on invariant checks
  passing against the loaded demo dataset.
- **Open:** do bank transactions enter as events at ingestion (pure) or at
  reconciliation match (pragmatic)? Recommend at ingestion, with matching as
  a downstream event (`BankTransactionMatched`).
- **Open:** account-coded deltas vs. a hybrid (typed deltas for the few
  modelled components + account-coded for the rest). Recommend pure
  account-coded; revisit only if a measurement module needs richer typing.

## 9. Recommendation

Adopt, via the strangler path. The concept is sound, demonstrated end-to-end
in the OpenFinance POC, and it *strengthens* rather than disturbs our two
differentiators — the agent framework (agents propose events; humans certify
state) and the live demo experience (LES **is** a live-flow data source;
certification is a new demo beat). Cost is real but bounded: one substrate
step before further process phases, no rewrite of what's shipped, and every
existing P2P demo keeps working throughout.
