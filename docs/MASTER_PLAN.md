# AgenticFinance 3.0 — Master Plan

**Status:** Draft for review · **Owner:** Alec · **Last updated:** 2026-10-01

## 1. What we are building

An agentic finance function for a small business, built as a demo-quality system
first and hardened to production later. It consists of:

1. **A mini ERP/EPM** on PostgreSQL — the system of record the business will
   eventually run on (master data, subledgers, GL, periods, budgets/forecasts).
   No integration to real ERPs; this *is* the ERP.
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

### Phase 0 — Repo restructure and foundations
- Restructure repo to the target layout (see ARCHITECTURE.md §8).
- PostgreSQL on Railway; migrations tooling; seed-data framework for the
  fictional company (name, chart of accounts, suppliers, customers, items).
- Deploy skeleton services to Railway via CLI (web + platform + Postgres).
- **Demo moment:** app loads, shows the company, empty queues, healthchecks.

### Phase 1 — Agent framework + workbench core
- Agent registry, releases, skills (versioned), work queue, runs, command
  gateway, audit/evidence tables.
- Agent runtime: Anthropic-SDK loop with typed tools, budgets, run transcripts.
- Workbench v1: agent roster, agent detail (config, skills, releases), work
  queue view, run viewer (step-by-step transcript), manual task submission.
- Eval harness v1: define test cases per agent, run suite, view pass/fail.
- One trivial "Hello Finance" agent proving the whole loop end to end.
- **Demo moment:** edit a skill in the UI → new version → run evals → promote
  → watch the agent work an item with the new behaviour.

### Phase 2 — Mini ERP core + P2P (first real process)
- ERP core: entities/periods, chart of accounts, GL journal + trial balance,
  supplier master, document store.
- P2P per its own plan (`docs/plans/P2P.md`): purchase orders, goods receipts,
  invoice capture (agent extraction from dummy PDFs), 3-way match
  (deterministic), **Invoice Exception Agent**, approval workflow, payment
  proposal → human approval → simulated payment, AP subledger posting to GL.
- Seeded exception scenarios (price variance, qty mismatch, missing receipt,
  duplicate invoice) so the agent always has interesting work in a demo.
- **Demo moment:** drop a dummy invoice in → extraction → match exception →
  agent investigates → human approves resolution → posted and visibly in TB.

### Phase 3 — R2R
- Per its own plan (`docs/plans/R2R.md`): period close checklist, recurring
  journals, accruals, bank reconciliation (dummy bank feed), **Close Agent**
  and **Reconciliation Agent**, close dashboard, reporting snapshot (P&L,
  balance sheet), flux/variance commentary drafted by agent.
- **Demo moment:** run a month-end close end to end on dummy data; agent
  drafts the close commentary; human certifies the snapshot.

### Phase 4 — O2C
- Per its own plan: customer master, sales orders, billing, AR subledger, cash
  application (agent matches dummy remittances), collections agent drafting
  dunning, credit notes with approval.

### Phase 5 — Performance Management
- Per its own plan: driver-based budget and forecast on the EPM tables,
  actuals-vs-budget variance, **Forecast Preparation Agent** gathering
  assumptions and drafting commentary, simple scenario runs, KPI dashboard.

### Phase 6 — Demo polish
- Guided demo script/tour, one-click seed reset, cross-process dashboard
  ("the finance function at a glance"), cost/usage reporting per agent.

### Phase P — Production version (stub)
- Real auth and role separation, security review, backups/DR, real bank/payment
  rails, data migration from demo, go-live checklist. **Deliberately not
  designed yet** — revisit when the business is ready (~3 months).

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
- Deterministic seed scripts generate 6 months of history: suppliers,
  customers, POs, invoices (including planted exceptions), bank transactions,
  budgets — so every demo starts from a rich, consistent state.
- `pnpm seed:reset` restores the pristine demo state in one command.
- Dummy documents (invoice PDFs, remittances) generated and stored with the
  seed so extraction agents have real-looking inputs.

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

## 9. Open questions (answer before Phase 0)

1. Confirm stack: TypeScript monorepo (Next.js workbench + Node platform
   worker) — see ARCHITECTURE.md §2. *(Recommended; say "yes" or state a
   preference for Python.)*
2. Fictional company: keep "Brightline Ltd / UK / GBP" or substitute something
   closer to your real business so the demo doubles as a rehearsal?
3. Any client-demo deadline that should shape phase ordering?
