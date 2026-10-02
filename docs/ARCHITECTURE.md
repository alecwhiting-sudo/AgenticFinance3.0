# Architecture — demo framework

**Status:** Draft for review · **Companion to:** `MASTER_PLAN.md` ·
**Source inspiration:** `research/Finance-Agent-Framework-Research.html`
(deliberately simplified; see §9 for what was dropped and why).

> **Living diagram:** `docs/architecture.html` renders this document's system
> view and the schema map (served in-app at `<api>/docs/architecture.html`,
> linked from Admin). Update it in the same commit as any structural change
> here — the diagram and this file must never disagree.

## 1. Shape of the system

Three deployables on Railway plus one database. A modular monolith split only
where deployment needs differ — not microservices.

```
┌────────────────────────┐   ┌──────────────────────────────┐
│  Workbench (Next.js)   │──▶│  Platform API (Node/TS)       │
│  agents · skills ·     │   │  REST/JSON · auth (single     │
│  queues · runs · evals │   │  role) · command gateway ·    │
│  ERP/EPM screens       │   │  finance services · registry  │
└────────────────────────┘   └──────────┬───────────────────┘
                                        │
┌────────────────────────┐              │
│  Agent worker (Node)   │──────────────┤
│  claims queue items ·  │              ▼
│  runs agent loops ·    │   ┌──────────────────────────────┐
│  calls Anthropic API   │   │  PostgreSQL (Railway)         │
│  runs eval suites      │   │  schemas: core · erp · epm ·  │
└────────────────────────┘   │  agent · evidence             │
                             └──────────────────────────────┘
                             + object storage for documents
                               (Railway volume or S3-compatible)
```

- **Workbench** — the UI for finance and technical users (one combined role in
  demo). Talks only to the Platform API.
- **Platform API** — owns all business logic: deterministic finance services,
  the command gateway, the agent/skill/release registry, queue management, and
  the ERP/EPM read models the UI needs. The single posting authority.
- **Agent worker** — a separate process so long-running model calls never block
  the API and can be scaled/restarted independently. It claims work items,
  assembles context, runs the agent loop, and submits **typed commands back to
  the Platform API** — it has no direct write access to ERP tables.
- **PostgreSQL** — system of record for everything: finance data, agent
  definitions, queues, runs, evidence, eval results. The work queue is a
  Postgres table with `FOR UPDATE SKIP LOCKED` claiming — no Kafka, no Redis,
  no Temporal in demo. Orchestration state is explicit status columns + a
  `process_step` table, good enough at demo volume.

## 2. Stack (proposed)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript end to end | One language for UI + API + worker; research doc's own recommendation |
| Monorepo | pnpm workspaces | `apps/web`, `apps/api`, `apps/worker`, `packages/*` |
| Front end | Next.js + Tailwind + shadcn/ui | Fast to make demo-pretty |
| API | Fastify (or Next API routes if we merge API into web later) | Light, typed |
| DB access | Drizzle ORM + SQL migrations | Schema-as-code, plain SQL when needed |
| Validation | Zod shared schemas in `packages/shared` | Same types for UI, API, agent tool outputs |
| LLM | Anthropic SDK; model per task from config (`ANTHROPIC_MODEL_*`) | Cheap model for extraction, stronger for investigation |
| Documents | Object storage + `document` table (hash, type, links) | Dummy PDFs for extraction demos |
| Deploy | Railway CLI; 3 services + Postgres plugin | Per master plan |

## 3. Core domain model

Postgres schemas keep concerns separate inside one database:

**`core`** — company, entity (one for now), fiscal calendar + periods (open /
closed), currency, users, roles (single role in demo), audit log.

**`erp`** — the mini ERP:
- Master data: account (CoA), supplier, customer, item, bank account.
- Subledgers: purchase_order, goods_receipt, ap_invoice, ap_payment,
  sales_order, ar_invoice, ar_receipt — each with an explicit status
  state machine (e.g. invoice: `captured → matched → exception → approved →
  posted → paid`).
- GL: `journal` (header) + `journal_line`, append-only once status=posted;
  reversal links; every journal carries `source_type`/`source_id` — **no
  orphan journals**. Trial balance and statements are views/queries.
- Amounts: `numeric(18,2)`, currency column, no floats.

**`epm`** — plan_version (budget/forecast/scenario), driver, assumption,
plan_line (account × period × amount), kpi_definition, kpi_value. Never mixed
into `erp.journal` — actuals are posted facts, plans are plans.

**`agent`** — the framework:
- `agent` — stable identity: id, name, purpose, owner, status.
- `skill` + `skill_version` — markdown instructions (+ optional few-shot
  examples), immutable versions.
- `agent_release` — immutable bundle: instructions, skill_version ids, tool
  permissions, model config, budgets, eval-suite result reference, status
  (`draft → evaluated → active → retired`), promoted_by/at. Exactly one
  active release per agent.
- `work_item` — queue: type, payload ref, status, claimed_by, attempt count,
  priority, scheduled_at.
- `agent_run` — one execution: agent_release_id, work_item_id, transcript
  (steps, tool calls, model usage), tokens/cost, outcome, duration.
- `command` — typed proposals from runs: type, params (Zod-validated),
  idempotency key, status (`proposed → approved → executed → verified |
  rejected | failed`), approval reference.
- `eval_case` + `eval_run` — per-agent test cases (input fixture + expected
  outcome + graded assertions), suite executions, per-case results.

**`evidence`** — document (hash, storage key, mime), case (groups work items,
runs, commands, documents and human decisions for one business matter, e.g.
one invoice exception), case_event (append-only timeline), human_decision
(who, what, when, rationale).

## 4. Execution flow (the one loop everything uses)

1. A business event (seeded, user action, or schedule) creates a `work_item`.
2. The worker claims it (`SKIP LOCKED`), looks up the item type's assigned
   agent and its **active release**.
3. Context assembly: the release's instructions + pinned skill versions +
   the case's evidence + relevant policy rows. Recorded as a context manifest
   on the run.
4. The agent loop runs with typed tools. Tools are of two kinds:
   - **reads** (query ERP/EPM/evidence through scoped API calls);
   - **proposals** (`propose_command`) — never direct writes.
5. The **command gateway** (in the API) validates each proposed command:
   schema, agent permissions for that command type, business preconditions
   (period open, status transition legal, amount within the agent's standing
   authority), idempotency. Commands above standing authority become human
   approval tasks in the workbench.
6. Approved commands execute inside deterministic services (posting, matching,
   payment simulation) in a DB transaction; result recorded; case timeline
   updated; work item completed or escalated.
7. Everything lands in the run transcript + case timeline, which is exactly
   what the workbench renders.

Deterministic steps (3-way match arithmetic, depreciation, posting) run as
plain service code inside the same flow — a work item only reaches the agent
loop when interpretation is needed.

## 5. Agent lifecycle (demo-sized)

- Create agent → write instructions/skills → attach tools + permissions +
  budgets → `draft` release.
- Run its eval suite from the workbench → results stored on the release.
- Promote to `active` (one click; records who/when). Previous release retires
  but stays attributable in history.
- All edits (instructions, skills, model, permissions) create a new draft
  release — nothing mutates an active release.
- Monitoring: per-agent dashboard of runs, outcomes, escalation rate, cost,
  eval trend.

Planned starting roster: Invoice Extraction Agent, Invoice Exception Agent
(P2P); Close Agent, Reconciliation Agent (R2R); Cash Application Agent,
Collections Agent (O2C); Forecast Preparation Agent (PM). Final roster per
each process plan.

## 6. Workbench information architecture

- **Dashboard** — finance function at a glance: queues, exceptions, close
  status, agent activity, spend.
- **Agents** — roster → agent detail (overview, releases, skills editor with
  version history, permissions, eval suite + results, run history).
- **Work** — queues and cases: open items, who/what is handling them, case
  detail with full timeline and evidence; approval inbox (payments, material
  journals, escalations).
- **ERP** — suppliers/customers/items, documents, subledger views, journals,
  trial balance, statements, period management.
- **EPM** — plan versions, assumptions, variance (appears in Phase 5).
- **Admin** — users, seed reset, model/config, usage & cost.

## 6a. Live experience layer (demo wow factor)

Visual feedback is a product requirement, not decoration: clients must *see*
the system working, tastefully. One mechanism powers all of it:

- Every meaningful step — work item claimed, tool called, command proposed,
  gateway decision, journal posted, human approval, exception raised — writes a
  row to `agent.activity_event` (actor, verb, object refs, case id, summary
  text, timestamp). The API exposes it as a **Server-Sent Events stream**
  (`GET /activity/stream`, filterable by agent/case/process); the workbench
  subscribes. No websocket infra, no polling.

What the UI does with it (minimal, tasteful — motion only where something real
happened; no spinners-for-show, no fake progress):

- **Live activity feed** — a quiet ticker on the dashboard; each event a single
  calm line ("Invoice Exception Agent requested goods receipt for INV-0231"),
  subtle fade-in, no sound, no toast storms.
- **Agent cards that breathe** — a soft pulse on the roster card while an agent
  holds a claimed item; idle cards are static.
- **Process flow view** — the signature demo screen: a horizontal pipeline per
  process (P2P: captured → matched → exception → approved → posted → paid)
  with document chips moving stage to stage as events arrive, exceptions
  branching visibly to the agent lane and back.
- **Run transcript, live** — a run page that renders the agent's steps as they
  happen: thinking summary, tool call, result, proposed command, gateway
  verdict. This is the "look inside the agent's head" moment.
- **Numbers that settle** — KPI tiles (open exceptions, items today, cost)
  animate briefly to their new value on change, then rest.
- **Demo pacing toggle** — an admin setting that throttles the worker slightly
  (e.g. 1–2s between visible steps) so live runs read as deliberate, not a
  flash; off = full speed. Pacing delays presentation of real events; it never
  fabricates events.

Design language: lots of whitespace, one accent colour, small type, motion
under 300ms. The `dataviz` conventions apply to all charts. Built in Phase 1
(stream + feed + agent cards + live transcript); the process flow view ships
with P2P in Phase 2 and is reused by O2C/R2R.

## 6b. Demo Data Studio (transaction & evidence generator)

A **Transaction Generator Agent** manufactures the business: transactions for
P2P, O2C and R2R plus their evidence — supplier invoice PDFs, POs, emails,
contracts/sales documents, remittance advices, bank statement lines.

**Two-stage design keeps LLM cost one-off and tiny:**

1. **Generate (LLM, once per dataset):** the agent produces *structured JSON*
   in batches — suppliers, customers, items, then correlated transaction
   narratives (a PO, its receipt, its invoice, the covering email, planted
   exceptions) with realistic names, line items, prose for emails/contracts.
   Batched ~25–50 records per call on a cheap model profile; a full dataset is
   tens of calls, not thousands. Regeneration is a button in the workbench
   Admin area ("rebuild demo dataset"), not a continuously running agent.
2. **Render (deterministic, free):** template code turns the JSON into
   artefacts — invoice/PO/contract PDFs from 3–4 HTML templates with varying
   supplier branding, `.eml`/markdown emails, CSV bank statements. Rendering
   costs nothing and is reproducible from the committed JSON.

**Target volume (impressive, not expensive):** ~6 months of history for
Brightline — ≈40 suppliers, 60 customers, 300 AP invoices (with PO/receipt
chains), 400 AR invoices, ~900 bank lines, 12–15% planted exceptions across
the known-exception taxonomy, plus a small daily "drip" generator that seeds
10–20 fresh items per demo day so queues never look dead. Roughly 800–1,000
small PDFs ≈ 40–60 MB.

**Storage (D10):** generated JSON + rendered documents are committed to the
repo under `packages/db/seed/` and deployed inside the Railway containers;
the `evidence.document` table stores metadata + file path, and the API serves
file bytes from disk. At this size git handles it comfortably — no Cloudflare/
S3 bill, no egress, survives redeploys because the repo is the source. Your
"folders on my drive" instinct is right; the repo *is* that folder, with the
bonus of versioning. Runtime-generated artefacts (e.g. payment confirmations)
are small and DB-stored. If the corpus ever outgrows git comfort (>250 MB),
move binaries to git LFS or a Railway volume — noted, not needed now.

The generator is itself a registered agent in the framework (identity, skills
defining the business's "story", eval checks that generated books balance and
exception quotas are met) — so it doubles as a demo of agents doing useful
non-finance work. Detailed plan: `plans/DEMO_DATA.md`.

## 7. Security posture (demo vs prod)

Demo: single shared role, simple email login, real controls that matter to the
*demo story* still enforced (command gateway, approval gates, append-only
journal, agent permission checks) because they ARE the product being shown.
Secrets in Railway env vars. Document text treated as untrusted (extraction
output is data, never instructions) from day one — cheap to do, good demo
point. Prod hardening (roles/segregation, SSO, RLS, backups, pen test): Phase
P stub, no design yet.

## 8. Target repo layout (Phase 0 restructure)

```
apps/
  web/        Next.js workbench
  api/        Platform API (finance services, gateway, registry)
  worker/     Agent runtime + eval runner
packages/
  shared/     Zod schemas, types, command definitions
  db/         Drizzle schema, migrations, seed scripts
agents/       Agent definitions-as-code: instructions, skills, eval fixtures
              (synced into the registry; editable from the workbench too)
docs/
  MASTER_PLAN.md · ARCHITECTURE.md · plans/ · research/ · decisions/
scripts/      deploy.sh (per-service railway up), seed:reset, dev helpers
```

The current `agents/example-agent` Python scaffold is removed in Phase 0
(superseded by this design).

## 9. Simplifications vs the research doc

| Research doc | Demo decision | Revisit |
|---|---|---|
| Durable orchestration engine (Temporal-class) | Postgres queue + explicit state machines | Phase P if volumes demand |
| Six knowledge libraries + hybrid retrieval | Skills + a small `policy` table; context assembled by explicit rules, no vector search | When corpus grows |
| Multi-entity, multi-currency, consolidation | One entity, GBP | Phase P / real business needs |
| ERP adapters, canonical finance API | None — our mini ERP is the ERP; internal service interfaces kept clean so an adapter layer could be added | Phase P |
| Novel-investigation sandbox + sponsorship flow | Out of scope; everything is routine or known-exception; unknowns escalate to a human case | Later if the demo needs it |
| Formal release sign-off + cryptographic manifests | One-click promote with recorded who/when + eval results | Phase P |
| Model routing ladder + budgets per release | Simple per-task model config + per-run token/cost caps and recording | Grow as needed |
| Separate service identities for segregation | Single role | Phase P |

What we did **not** simplify: single posting authority, append-only journal,
typed commands through a gateway, agent releases with attribution, human
approval on money movement, evidence timelines, evals before promote.

## 10. Decision log

| # | Decision | Status |
|---|---|---|
| D1 | TypeScript monorepo (web/api/worker) | Agreed (Alec, 2026-10-01) |
| D2 | Postgres-only infra (queue, state) — no Kafka/Redis/Temporal | Agreed (Alec, 2026-10-01) |
| D3 | Build order: Framework → P2P → R2R → O2C → PM | Agreed (Alec, 2026-10-01) |
| D4 | Mini ERP owns the ledger; no external ERP integration | Agreed (Alec, 2026-10-01) |
| D5 | Single combined user role for demo | Agreed (Alec, 2026-10-01) |
| D6 | Prod version stubbed, unplanned | Agreed (Alec, 2026-10-01) |
| D7 | Drizzle + Zod + Fastify + Next.js | Agreed (Alec, 2026-10-01) |
| D8 | Fictional company "Brightline Ltd" (UK, GBP) | Agreed by default (rename welcome) |
| D9 | Live activity stream (SSE + `activity_event` table) powers all visual feedback | Agreed (Alec, 2026-10-01) |
| D10 | Demo documents generated once, committed to the repo, served from the container's filesystem — no paid object storage in demo | Agreed (Alec, 2026-10-01) |
| D11 | Agent granularity: several agents per process, split by authority/capability profile, never by step — see `decisions/001-agent-granularity.md` | Agreed (Alec, 2026-10-02) |
| D12 | Unified Purchase model: requisition + PO are one record; approve once at intent via policy bands; clean matches post and pay with no second approval (plans/P2P.md §0) | Agreed (Alec, 2026-10-02) |
| D13 | **Finance Data Platform (FDP) replaces the "mini ERP" back end** (supersedes D4's framing; the ledger stays ours). Economic state is event-native: an append-only event store with `(source_system, source_event_key)` idempotency is the sole root of economic truth; a deterministic posting pipeline turns each event into account-coded deltas written atomically as an immutable movement ledger + live balances (LES) + a balanced double-entry journal (DB-enforced). Close = lock (physical snapshot, LRS) → certify (immutable) → supersede (restatement); never a recalculation. Journals are classed SDJ (system) / GOJ (human-approved via the command gateway). **Two entry postures, one pipe:** finance-initiated modules (P2P, O2C) submit events *with* proposed account-coded deltas attached; business-initiated flows (future insurance-style events) submit events without accounting and the engine derives the deltas — same validation and write path either way, so replay reproduces journals in both. Modules (P2P/R2R/O2C/PM) remain the client-facing functional areas and agent families over this one shared store (Workday-like posture); demos understate the platform and foreground the agents. Full analysis: `analysis/finance-data-platform.md`. | Agreed (Alec, 2026-10-02) |
