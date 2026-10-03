# AgenticFinance 3.0 — Master Plan

**Status:** Draft for review · **Owner:** Alec · **Last updated:** 2026-10-01

## 1. What we are building

An agentic finance function for a small business, built as a demo-quality system
first and hardened to production later. It consists of:

1. **A Finance Data Platform (FDP)** on PostgreSQL — the system of record
   the business will eventually run on: one set of tables acting as data
   store + ledger combined (event store, movement ledger, live balances,
   journals, locked reporting snapshots — ARCHITECTURE.md D13,
   `analysis/finance-data-platform.md`). Clients experience it through
   familiar modules and can think of it as the ERP; no integration to real
   ERPs — this *is* the system of record. (Supersedes the original "mini
   ERP/EPM" framing; Phase 2 built the GL/subledger surface that the FDP
   substrate now slides under.)
2. **An agent framework** — a small, disciplined version of the research
   architecture (`docs/research/Finance-Agent-Framework-Research.html`):
   deterministic services do accounting; agents interpret, investigate and
   propose; a command gateway enforces authority; everything is attributable to
   a named agent and release.
3. **A workbench front end** — where finance and technical users (one combined
   role for now) manage agents, edit and version their skills, monitor work,
   review outcomes, run tests and evals.
4. **Four finance processes** run by agents on top of the framework:
   - **P2P** (procure-to-pay) — first
   - **R2R** (record-to-report) — second
   - **O2C** (order-to-cash)
   - **PM** (performance management / FP&A: budgets, forecasts, variance)

Each process gets its own plan in `docs/plans/` before it is built.

## 2. Guiding constraints

- **Demo first.** Everything runs on dummy data for a fictional company for at
  least 3 months. It must *demo well to clients*: clean UI, visible agent
  activity, believable finance data, resettable seed data.
- **Simple over complete.** We keep the research doc's load-bearing ideas
  (deterministic posting, command gateway, agent releases, evidence, evals) and
  drop its enterprise weight (multi-tenant, multi-entity consolidation, ERP
  adapters, Temporal-class orchestration, six separate libraries). One entity,
  one currency to start, one combined user role.
- **Small steps.** Every milestone ends in something runnable and demoable.
- **Prod is a stub.** A production version (real money, real controls, real
  auth) is Phase P at the end of the roadmap with no further thought yet.

## 3. Principles carried over from the research doc

These are the non-negotiables we keep even at demo scale:

1. **Deterministic core.** Posting, matching, calculations, period control and
   validation are plain code with tests. Agents never compute a journal line.
2. **One posting authority.** Only the ledger service writes journals; the
   journal is append-only after posting (reversals, not edits).
3. **Agents propose, the gateway disposes.** Every agent action with a business
   effect goes through a typed command checked against the agent's permissions
   and current state. Model text is never evidence of approval.
4. **Named agents with versioned releases.** Each agent has a stable identity;
   its instructions, skills, tools and model config form a release. Every run
   records which release acted. Skill edits create new versions, promoted
   deliberately — never silently live.
5. **Human approval where money moves.** Payments and material journals need a
   human click in the workbench, even in demo.
6. **Evidence and attribution.** Every case links its inputs, agent run,
   decisions and outcome so the workbench can show "what happened and why".
7. **Evals as a first-class feature.** Agents ship with test cases; the
   workbench runs them and shows results before a release is promoted.

## 4. Roadmap

Phases are sequential; milestones within a phase are the "small steps". Each
phase ends demo-ready.

### Phase 0 — Repo restructure and foundations ✅ built 2026-10-01
*(Code complete and verified locally; Railway project creation + first deploy
is a one-time manual step — see README "Deploying to Railway".)*
- Restructure repo to the target layout (see ARCHITECTURE.md §8).
- PostgreSQL on Railway; migrations tooling; seed-data framework for the
  fictional company (name, chart of accounts, suppliers, customers, items).
- Deploy skeleton services to Railway via CLI (web + platform + Postgres).
- **Demo moment:** app loads, shows the company, empty queues, healthchecks.

### Phase 1 — Agent framework + workbench core ✅ built 2026-10-01
*(Registry, skills/releases, queue, runs, command gateway, SSE activity feed,
run viewer, eval harness, Hello Finance proof agent, and Demo Data Studio v1
(deterministic generate/render/validate pipelines, dataset committed) are
built and verified. Deferred: LLM enrichment + live-LLM runs once an
ANTHROPIC_API_KEY is configured; daily drip wires in with P2P M5.)*
- Agent registry, releases, skills (versioned), work queue, runs, command
  gateway, audit/evidence tables.
- Agent runtime: Anthropic-SDK loop with typed tools, budgets, run transcripts.
- **Live experience layer v1** (ARCHITECTURE.md §6a): activity_event + SSE
  stream, live activity feed, breathing agent cards, live run transcript,
  demo pacing toggle.
- Workbench v1: agent roster, agent detail (config, skills, releases), work
  queue view, run viewer (live step-by-step transcript), manual task
  submission.
- Eval harness v1: define test cases per agent, run suite, view pass/fail.
- **Demo Data Studio v1** (ARCHITECTURE.md §6b): the Transaction Generator
  Agent — the first real agent on the framework — generates Brightline's
  masters and P2P dataset (JSON once via LLM, documents rendered free from
  templates, committed to the repo). Includes the daily "drip" of fresh items.
- **Demo moment:** edit a skill in the UI → new version → run evals → promote
  → watch the generator agent work live in the activity feed and transcript.

### Phase 2 — Mini ERP core + P2P (first real process) ✅ built 2026-10-02
- ERP core: entities/periods, chart of accounts, GL journal + trial balance,
  supplier master, document store.
- P2P per its own plan (`docs/plans/P2P.md` v2 — the **unified Purchase
  model**, D12): purchases created at the moment of intent (requisition and
  PO are one record; the supplier "PO" is a rendered view), policy-banded
  approval (auto / standard / director — approve once, no re-approval at
  invoice time), goods receipts, invoice capture (agent extraction from dummy
  PDFs), deterministic 3-way match against the approved Purchase with
  straight-through posting + payment scheduling for clean matches,
  **Purchase Request Agent** (conversational intake), **Invoice Exception
  Agent**, human-approved exception resolutions, simulated settlement, AP
  posting to GL.
- Seeded exception scenarios (price variance, qty mismatch, missing receipt,
  duplicate invoice) so the agent always has interesting work in a demo —
  supplied by the Demo Data Studio.
- **Process flow view** for P2P (the signature live pipeline screen, §6a).
- **Demo moment:** drop a dummy invoice in → watch it move across the live
  pipeline → match exception branches to the agent → human approves the
  resolution → posted and visibly in the trial balance.

### Phase 2b — FDP substrate (strangler step 1–2, D13) ✅ built 2026-10-02
- Add the platform tables (event store with idempotency, movement ledger,
  engine/config versions, parameter sets) and the validated posting pipeline
  (event → account-coded deltas → movement + journal + live balances, one
  transaction). P2P/O2C services switch to emitting events with their
  accounting attached instead of posting journals directly; DB-level
  immutability triggers and a deferred journal-balance constraint; replay
  command wired into the test suite. Existing API shapes, UI and demos
  unchanged — clients see no difference.
- **Demo moment (quiet, for technical buyers only):** drill any TB number →
  movement → event → the agent run that produced it; replay the full event
  history and show identical balances.

### Phase 3 — R2R
- Per its own plan (`docs/plans/R2R.md`), on the FDP: full bank
  reconciliation (deterministic kind-rules + **Reconciliation Agent** for
  the ambiguous), accruals/prepayments as the first measurement
  transformation (engine derives deltas from bare events + versioned
  parameter sets), recurring journals, monthly P&L + balance sheet
  (drillable), month-end dashboard, **Close Agent** flux/variance
  commentary. Reports always state their basis.
- **Deferred (Alec, 2026-10-02):** LRS lock → certify → supersede and
  reconciliation gates — lands later as the dashboard's lock button + the
  snapshot tables (D13 strangler step 3); nothing in Phase 3 needs rework
  for it.
- **Demo moment:** reconcile the bank live; run month-end postings through
  the one pipe; agent drafts the close commentary from the statements.

### Phase 4 — O2C ✅ built 2026-10-02
- Per its own plan: customer master, sales orders, billing, AR subledger, cash
  application (agent matches dummy remittances), collections agent drafting
  dunning, credit notes with approval. Same entry posture as P2P (D13):
  contracts/billing push the business event and its accounting together
  through the one pipe.

### Phase 4c — Analytics & natural-language reporting (built 2026-10-03 minus saved views; plan: plans/ANALYTICS.md)
- A reporting layer for exploring ALL platform data, not just the fixed
  statements: pick any dimension (account, supplier, customer, period,
  object, agent), slice/pivot, and chart it (trend, bar, waterfall for flux,
  aging curves). Derived aggregations over LES/journal lines only — the
  reporting layer never recalculates economics, and every chart drills to
  the underlying movements/events.
- **Natural-language analytics:** an Analyst Agent that turns questions
  ("why did software costs jump in September?", "top 5 customers by overdue
  balance") into governed read-only queries over curated views, answers with
  the chart + the figures, and cites the drill path. Read-only by
  construction; query shapes constrained to the curated views (no raw SQL
  from the model against the platform).
- Saved views land on a dashboard; the Close Agent's commentary upgrade
  (plans/R2R.md §9) feeds off the same layer.
- **Analyst chat panel (Alec, 2026-10-03):** a persistent right-hand chat
  surface in the workbench where the user talks to their data — trends,
  variances, "why did X move" — answered by the Analyst Agent with charts
  and figures plus the drill path. Grounded by construction: it reads the
  curated views (never raw SQL from the model), and its context includes
  the data model, the architecture decisions (D1–D15) and any saved
  analyses, so it can explain how a number was produced, not just what it
  is. Same gateway rules as every agent: read-only, attributable, every
  answer cites its sources.

### Phase 5 — Performance Management
- Per its own plan: driver-based budget and forecast on the EPM tables,
  actuals-vs-budget variance, **Forecast Preparation Agent** gathering
  assumptions and drafting commentary, simple scenario runs, KPI dashboard.

### Phase 6 — Demo polish
- Guided demo script/tour, one-click seed reset, cross-process dashboard
  ("the finance function at a glance"), cost/usage reporting per agent.

### Phase 7 — A2R: Acquire to Retire (low priority)
- Full fixed-asset lifecycle as the fourth-and-a-half process family:
  asset acquisition from P2P purchases (capitalise instead of expense),
  asset register, depreciation runs as period-tick events through the one
  pipe (engine-derived deltas from versioned depreciation parameter sets —
  the business-initiated posture D13 was designed for), revaluations,
  disposals/retirements with gain/loss. Agents: asset classification
  (capitalise vs expense at invoice capture), depreciation review.
- Deliberately low priority (Alec, 2026-10-03) — after analytics (4c) and
  the exceptions build-out; before or alongside PM as appetite dictates.

### Phase P — Production version (stub)
- Real auth and role separation, security review, backups/DR, real bank/payment
  rails, data migration from demo, go-live checklist. **Deliberately not
  designed yet** — revisit when the business is ready (~3 months).
- Database: demo runs Railway's managed Postgres (full standard Postgres,
  private network, no cold starts). Evaluate **Neon** at this phase for
  branching + point-in-time restore; we use plain Postgres only, so migration
  is pg_dump/restore + a DATABASE_URL swap.

## 5. Build order rationale

Framework before processes because every process reuses the same registry,
queue, gateway and workbench. P2P first because it is the best agent showcase
(document extraction + exception investigation + approval + posting) and
exercises every framework feature. R2R second because it turns P2P's postings
into statements — together they already look like a finance function. O2C and
PM then reuse mature plumbing.

## 6. Demo data strategy

- One fictional company (working name: **Brightline Ltd**, a ~15-person UK
  services/products business), one entity, GBP, monthly periods.
- The **Transaction Generator Agent** (Demo Data Studio, ARCHITECTURE.md §6b)
  manufactures 6 months of correlated history for P2P, O2C and R2R — masters,
  POs, receipts, invoices, contracts, emails, remittances, bank lines — with
  12–15% planted exceptions, plus a daily drip of fresh items so queues never
  look dead in a demo.
- **Cost control:** LLM generates structured JSON once per dataset (tens of
  cheap batched calls, single-digit £); documents are rendered from templates
  deterministically for free; artefacts are committed to the repo and served
  from the container's filesystem — no object-storage or egress costs.
- `pnpm seed:reset` restores the pristine demo state in one command without
  re-invoking the LLM.

## 7. Per-process plans

Each of `docs/plans/P2P.md`, `R2R.md`, `O2C.md`, `PM.md` is written (and
reviewed by Alec) before its phase starts. Template: scope, data model
additions, deterministic services, agents (identity, skills, tools,
permissions), exception workflows, human approval points, eval cases, demo
script, out of scope.

## 8. Success criteria for the demo system

- A client demo can run end to end in under 15 minutes without a restart.
- Every agent action in the demo is explainable from the workbench (release,
  skills used, evidence, transcript).
- Trial balance balances at all times; no journal exists without a source.
- A skill change demonstrably alters agent behaviour only after eval + promote.
- Alec can add a new exception scenario via seed data without code changes to
  the framework.

## 9. Resolved questions

1. Stack: TypeScript monorepo confirmed (Alec, 2026-10-01).
2. Fictional company: Brightline Ltd / UK / GBP by default; Alec can rename at
   any point before Phase 1 seeds are generated.
3. No client-demo deadline given; phases stay as ordered.
4. Visual feedback is a core requirement (ARCHITECTURE.md §6a) — tasteful,
   minimal, impactful; built into Phase 1 and every process phase.
5. Demo documents live in the repo and are served from the container's disk —
   no paid object storage for the demo (ARCHITECTURE.md §6b, D10).
