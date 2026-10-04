# STATUS — where the build is up to

**Purpose:** the one page a new session (or human) reads to resume. Keep it
honest and short; update it in the same commit as any milestone, deferral or
decision. Detail lives in `MASTER_PLAN.md` (phases), `ARCHITECTURE.md`
(decisions D1–D16), `docs/plans/*` (per-process), and the living diagram
`docs/architecture.html` (in-app at `/admin/architecture`).

_Last updated: 2026-10-03_

## Phase tracker

| Phase | State | Notes |
|---|---|---|
| 0 — Foundations | ✅ built | monorepo, Railway (web/api/worker + Postgres), migrations 0000–0008 |
| 1 — Agent framework + workbench | ✅ built | registry, versioned skills/releases, queue, runs, command gateway, SSE feed, evals, Demo Data Studio |
| 2 — P2P | ✅ built | unified Purchase (requisition=PO, D12), banded approval, GRNs, 3-way match, extraction (PDF/UBL XML/scan via Haiku vision), exception agent, payments + settlement |
| 2b — FDP substrate (D13 steps 1–2) | ✅ built | event store → deltas → movements + journals + LES, one validated pipe (`fdpPost`), immutability triggers, deferred balance constraint, replay verified |
| 3 — R2R | ✅ built minus deferral | bank rec + Reconciliation Agent, accruals/prepayments engine, recurring journals, P&L/BS, month-end dashboard, Close Agent commentary. **Deferred:** LRS lock → certify → supersede (D13 step 3) |
| 4 — O2C | ✅ built | AR invoices through the pipe, cash application + agent, collections agent + dunning approval |
| 4c — Analytics + Analyst | ✅ built | plan: `plans/ANALYTICS.md`. M1 `/analytics` (flux waterfall, P&L trend, AP/AR aging, counterparty, cash — all drill, all have table views). M2 Analyst Agent + right-hand chat panel (top-bar toggle): answers from the curated views only, cites sources, keyless fallback for set question shapes. Remaining 4c ideas: saved views/dashboard |
| 5 — Performance Management | 📋 planned | user: not ready yet |
| 6 — Demo polish | 🔶 partial | agent staff strip, release pipeline, permissions matrix, decision history, per-agent period cost (D14), admin reset/replay done; guided tour + cross-process dashboard outstanding |
| P — Production | ⬜ stub | deliberately undesigned |

## What runs today

- **Live on Railway** (GitHub auto-deploy from `main`-equivalent branch pushes;
  dashboard "Redeploy" does **not** rebuild): web, api
  (`api-production-7cea.up.railway.app`), worker (needs `API_URL` env — set).
- **Dataset:** 300 AP chains (each: requisition+PO → GRN (288) → invoice,
  36 planted exceptions: price_variance, qty_short_receipt, missing_receipt,
  no_purchase, duplicate_suspect, bank_detail_change), 400 AR invoices,
  508 bank lines, 110 UBL e-invoices, 50 scan-style PDFs. All committed in
  `packages/db/seed/generated/` — internal docs (PO/GRN) are schema rows;
  only supplier-facing artefacts are rendered PDFs.
- **Agents (10, by family):** p2p: purchase-request, invoice-extraction
  (Haiku), invoice-exception · r2r: reconciliation, close, analyst · o2c:
  cash-application, collections · platform: hello-finance,
  transaction-generator. All evals green at last run.
- **Invariants proven:** fresh load = 1159 events = 1159 journals, GL balance
  0; replay from zero reproduces identical state; immutability + balance
  controls attack-tested; 30 unit tests.
- **Test panel** (`/test`, in the nav): the scenario catalog — each scenario
  states what it does, what data it uses, what it proves and what it does
  NOT prove, cost and duration, before you run it (month-by-month, 10x,
  cold-start agent extraction, replay, simulate-a-day, drips, clear-to-zero).
  Mission control board at `/admin/pipeline`. Admin keeps maintenance
  (flush-history) + the clickable architecture diagram (component explainer).
- **Cost engineering (D15)**: prompt caching (raw token split stored,
  priced at read time per tier) + learned extraction templates (suppliers
  promote off the model after 3 validated extractions; savings measured).
- **Central skill map (2026-10-03)**: `agent.agent_skill` (migration 0012)
  holds which skills each agent is MEANT to carry — the curriculum, stored
  once centrally. Releases stay the enforced snapshot: a rebuild without
  explicit versions reads the map and pins each skill's latest version
  (`PUT /agents/:slug/skill-map` replaces the map + drafts that release).
  The library's "Mapped into" chips show both states: pinned vN (active)
  or "awaiting release".
- **Deploys are self-contained (2026-10-03)**: the api boot script applies
  pending migrations and refreshes the registry seed (non-destructive) before
  the server starts — new skills/agents/migrations land on push, no manual
  `railway run`. Opt out: `MIGRATE_ON_BOOT=false`.
- **Book codes (D16, 2026-10-04)**: `book` dimension on events, journals,
  purchases, AP invoices and commands — `main` is the real books (future
  GAAP books join the dimension), `test` is where eval-originated commands
  execute the FULL pipeline. The gateway derives the book from the run's
  work item (unspoofable); statements, TB, analytics, queues and the
  approvals inbox read `book <> 'test'`. Verified: eval suites run green
  while main stays byte-identical (1159 journals, balance 0, inbox
  unchanged; test book carries the eval purchases/commands). Evals are now
  a standing in-prod assurance control, not a pollution source.
- **Stale-pin refresh (2026-10-04)**: the library banners when any agent's
  active release pins older skill versions. Refresh is two-step: a preview
  (`GET /agents/releases/refresh-stale`) names every agent being updated,
  its purpose, what it proposes (the consequence surface), exact skill
  version changes and its eval-gate strength, plus a "run baseline evals
  first" action (evals current releases for before/after comparison); only
  then confirm (`POST`) drafts rebuilt releases from the central map, runs
  each suite AGAINST THE DRAFT (eval work items target a specific release)
  and auto-promotes only on fully green (promoted_by=eval-harness). No eval
  cases = no gate = draft only, manual promote.
- **Skill template (2026-10-03)**: all 21 skills follow seven standard
  headings — Purpose & trigger / Inputs / Grounding / Method / Outputs &
  format / Escalation & never-do / Quality bar (UI_CONVENTIONS §5.1); the
  New-skill form carries the skeleton; rolled out as new skill versions via
  the seed upgrade path.
- **Skills library v2 (2026-10-03)**: 21 skills clustered by topic (P2P,
  O2C, R2R, Analytics, Controls & audit, Planning & performance, Platform)
  in a master-detail page — read first, Edit as a separate step. Controls
  and FP&A skills seeded ahead of need (controls map, controls testing
  method, SoD, JE testing, payment fraud, variance method, driver
  forecasting, budget cycle, close checklist, credit policy). Seed now
  upgrades its own skill versions (new immutable version when text changes;
  backs off once a human authored the latest) — stale release pins surface
  in the library.

- **App shell (2026-10-03)**: Mercury-style full-width layout — left
  sidebar with section/sub-navigation, slim top bar, mission control merged
  into the Test panel (board renders beside the scenario), system/light/
  dark theme toggle in Admin (pre-paint script, localStorage).
- **Design system v2 (UI_CONVENTIONS Part 4, 2026-10-03)**: Inter + IBM Plex
  Mono (table numerics/money/IDs render mono automatically via the
  tabular-nums convention; KPI values proportional sans), money precision
  ladder + moneyCompact, variance coloured by meaning, Kpi/Button/PageHeader
  primitives, hover-lifts removed. Remaining sweep: adopt Kpi/Button on the
  older pages opportunistically.

## Backlog (agreed, not yet built)

1. **Release governance** (`plans/RELEASE_GOVERNANCE.md`, decision
   2026-10-04): eval runs currently execute against the live books — fine
   for a disposable demo, not practice. Plan: M1 eval isolation (simulated
   commands, never executed, never in the inbox) → M3a control-regression
   diff on skill changes → M2 shadow replay with a measured impact report
   (exceptions up/down by code, changed recommendations, cost per case) →
   M3b AI release reviewer grounded in those measurements → M4 real test
   environment + canary (production phase).
2. **Phase 4c follow-ons** — saved views on a dashboard; data permissions
   (stubbed: every record-catalogue entity declares an `access` scope,
   enforcement designed in `plans/ANALYTICS.md` §3c). Core 4c built
   2026-10-03 incl. the record catalogue (`query_records` — the Analyst can
   scan actual records, not just the aggregate views).
3. **LRS lock/certify/supersede** — lands as the month-end dashboard's lock
   button + snapshot tables.
4. **Commentary quality** — Close Agent output is too bland; skills +
   evals that fail bland output (`plans/R2R.md` §9); reasoning tier only on
   eval evidence.
5. **Phase 6 remainder** — guided demo tour, cross-process dashboard.
   (Demo scenarios + mission control at `/admin/pipeline` built 2026-10-03:
   month-by-month processing, timed full-speed 10x run with remembered
   side-by-side, simulate-a-day — `plans/DEMO_SCRIPTS.md`.)
6. **Exceptions management M2** — M1 built 2026-10-03 (`/p2p/exceptions`
   workbench: grounded costed options via `case.options`, 3-way diff,
   one-click apply). Remaining: supplier email drafts on options, tolerance
   parameter sets, option evals, O2C mirror (`plans/P2P.md` §10,
   `plans/O2C.md` §9).
7. **A2R — Acquire to Retire** (fixed assets: capitalise from P2P,
   depreciation as engine-derived period ticks, disposals) — low priority
   (MASTER_PLAN Phase 7).
8. **Phase 5 PM** — parked on user's call.

## How to resume a session

1. Read this file, then skim `ARCHITECTURE.md` decisions and the relevant
   `docs/plans/*.md` before touching anything structural; update
   `docs/architecture.html` in the same commit as structural changes.
2. Branch discipline and conventions: see `CLAUDE.md`. `pnpm -r typecheck &&
   pnpm -r build` before every push.
3. Local verify loop: start Postgres, `pnpm db:migrate && pnpm db:seed`, run
   api/worker/web (ports 3001/3002/3000). Reset via the in-app Admin panel or
   `seed:reset`.
4. Deploys happen on push (Railway watches the repo). Data resets on the live
   system: Admin panel, or `RESET_DATASET=true` env on api (delete after).
