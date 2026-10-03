# STATUS — where the build is up to

**Purpose:** the one page a new session (or human) reads to resume. Keep it
honest and short; update it in the same commit as any milestone, deferral or
decision. Detail lives in `MASTER_PLAN.md` (phases), `ARCHITECTURE.md`
(decisions D1–D14), `docs/plans/*` (per-process), and the living diagram
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
| 4c — Analytics + NL reporting | 📋 planned (next big build) | charting over LES/journals + Analyst Agent on governed read-only views |
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
- **Agents (9, by family):** p2p: purchase-request, invoice-extraction
  (Haiku), invoice-exception · r2r: reconciliation, close · o2c:
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

## Backlog (agreed, not yet built)

1. **Phase 4c** analytics layer + NL Analyst Agent (before PM).
2. **LRS lock/certify/supersede** — lands as the month-end dashboard's lock
   button + snapshot tables.
3. **Commentary quality** — Close Agent output is too bland; skills +
   evals that fail bland output (`plans/R2R.md` §9); reasoning tier only on
   eval evidence.
4. **Phase 6 remainder** — guided demo tour, cross-process dashboard.
   (Demo scenarios + mission control at `/admin/pipeline` built 2026-10-03:
   month-by-month processing, timed full-speed 10x run with remembered
   side-by-side, simulate-a-day — `plans/DEMO_SCRIPTS.md`.)
5. **Exceptions management M2** — M1 built 2026-10-03 (`/p2p/exceptions`
   workbench: grounded costed options via `case.options`, 3-way diff,
   one-click apply). Remaining: supplier email drafts on options, tolerance
   parameter sets, option evals, O2C mirror (`plans/P2P.md` §10,
   `plans/O2C.md` §9).
6. **A2R — Acquire to Retire** (fixed assets: capitalise from P2P,
   depreciation as engine-derived period ticks, disposals) — low priority
   (MASTER_PLAN Phase 7).
7. **Phase 5 PM** — parked on user's call.

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
