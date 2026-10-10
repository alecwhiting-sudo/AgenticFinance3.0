# STATUS — where the build is up to

**Purpose:** the one page a new session (or human) reads to resume. Keep it
honest and short; update it in the same commit as any milestone, deferral or
decision. Detail lives in `MASTER_PLAN.md` (phases), `ARCHITECTURE.md`
(decisions D1–D16), `docs/plans/*` (per-process), and the living diagram
`docs/architecture.html` (in-app at `/admin/architecture`).

_Last updated: 2026-10-07_

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
- **Dataset v2 (2026-10-04):** Jan–Sep 2026 — 450 AP chains, 54 planted
  exceptions across 8 codes (incl. v2: bank_detail_mismatch wrong-IBAN
  fraud ×5, total_mismatch multi-page trap ×1), 600 AR invoices, 821 bank
  lines, 135 UBL e-invoices, 75 scan PDFs (10 poor tier), 5 multi-page
  invoices. Flaw catalogue: `plans/TEST_DATA_MAP.md`. All committed in
  `packages/db/seed/generated/` — internal docs (PO/GRN) are schema rows;
  only supplier-facing artefacts are rendered PDFs.
- **Agents (10, by family):** p2p: purchase-request, invoice-extraction
  (Haiku), invoice-exception · r2r: reconciliation, close, analyst · o2c:
  cash-application, collections · platform: hello-finance,
  transaction-generator. All evals green at last run.
- **Invariants proven:** fresh load = 1797 events = 1797 journals, GL balance
  0, zero planted-vs-derived exception mismatches; v1 months regenerate
  byte-identical from the Studio; replay from zero reproduces identical
  state; immutability + balance controls attack-tested; 30 unit tests.
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
  while main stays byte-identical (verified at 1159 journals, balance 0, inbox
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

1. **Release governance** (`plans/RELEASE_GOVERNANCE.md`): M1 built as D16
   book codes; **M3a built** (control-regression diff: dropped never-do/
   method lines flag red on the refresh preview, Confirm gated on explicit
   acceptance); **M2a built** (live-data eval cases via selectors —
   oldest open exception, most overdue AR — invariant assertions incl.
   `outcome_in`, skipped-passed when no record matches, eval suites now
   target a specific release). **Boot-time stale-pin refresh BUILT
   2026-10-07**: every api boot (deploy) drafts refresh releases from the
   skill map, queues their eval suites, and the worker auto-promotes on
   green — no manual "refresh stale pins" step remains. Control-regression
   moves auto-accept ONLY for seed-authored skill versions (the commit is
   the acceptance, logged loudly at boot); UI-authored ones still wait for
   the Agents-page confirm; agents with no eval cases (transaction-
   generator) still get a manual-promote draft. Opt out:
   `REFRESH_PINS_ON_BOOT=false`. Seed now also UPDATES changed eval cases
   in place (matched by agent+name), so a raised quality bar ships.
   **M2 shadow replay BUILT 2026-10-10**: on the agent page, a draft
   release re-runs the agent's real recent cases in the test book and the
   impact report (would-change case list with run links, changes by
   exception code, escalation rate and cost baseline → draft) sits beside
   the Promote button. Baselines read from run transcripts (reset-proof);
   test-book display-only commands no longer touch real case timelines,
   the shared commentary table, or live board packs.
   Remaining: M3b AI release reviewer grounded in the impact report → M4
   real test environment + canary (production phase).
2. **Dataset v2 + period lens + chat dashboards** (`plans/DATASET_V2.md`,
   planned 2026-10-04): sequenced packages — A map of existing flaws
   (`plans/TEST_DATA_MAP.md`, done) → **B period lens BUILT 2026-10-04**
   (month/quarter/YTD picker on TB, statements, analytics + account drill;
   one shared lens model in `@af/shared`, `?lens=` in the URL +
   localStorage so it follows you between pages; quarter/YTD flux compares
   the window to the equal-length prior window; aging as-of window end;
   Analyst views take the same from/to params) → **C dataset v2 BUILT 2026-10-04**
   (Jan–Mar extension; 5 multi-page invoices incl. the AC-75726 trap;
   supplier IBANs + `bank_detail_mismatch` and `total_mismatch` intake
   controls — both human-only/never-silent; poor-scan tier ×10; playbook +
   extraction skills updated (stale pins expected — refresh via the
   governance flow); new eval cases; invariants 1797) → **D scenario
   windows + /test/plants BUILT 2026-10-04** (wipe-and-load any month
   range from the Test panel — Jan–Jun/Apr–Sep presets + custom picker;
   /test/plants, off the main nav, renders the live test data map from the
   dataset itself) → **E chat-built boards BUILT 2026-10-04, ONE OPEN DEFECT** (ask the
   Analyst to "build me a page…" → it proposes a `board:` composition from
   the curated views → one click creates it at /analytics/boards/{slug};
   core.dashboard table, migration 0015; boards honour the period lens;
   chart house rules UI_CONVENTIONS §4.8 — validated 6-slot categorical
   palette, consistent accounting-paren axis ticks — enforced by the shared
   primitives, so chat-built pages inherit them; supersedes "saved views").
   **Defect RESOLVED 2026-10-05:** the board rule never reached the live
   prompt (`buildSystemPrompt` call site dropped `taskType`); fixed, plus
   the abstain rule now exempts PROPOSALS, and the convention moved into
   the curated-views skill (v3) so governance owns it — analyst release
   refreshed and auto-promoted on a green suite. Live pins now refresh
   themselves on every deploy (boot refresh, 2026-10-07); still worth one
   model-path retry of the build-a-page prompt on live.
   Root-cause record: `plans/DATASET_V2.md` § Known issue.
   → **F home dashboard revamp BUILT 2026-10-05**, merged via the
   repo's first reviewed GitHub PR (alecwhiting-sudo/AgenticFinance3.0#1):
   money row with cash sparkline, motion row (invoices today,
   straight-through %, exceptions, model spend), live run strip on the
   front door during loads, agent roster showing who is working NOW;
   master-data counts moved to Admin. **All plan packages A–G built.**
3. **Board Pack Agent (PR-G) — BUILT 2026-10-05** (jumped the queue):
   R2R → Board packs. Pick month/quarter/YTD → the board-reporter agent
   drafts a five-section pack (exec summary, P&L movers, cash, working
   capital, controls & exceptions incl. fraud holds) via one display-only
   `report.board_pack.save`; packs persist with drafting/draft/failed
   status (safe to leave the page), book-scoped so eval packs never show;
   "edit the Board pack method skill → eval gate → re-draft" loop linked
   from both pages; print/save-as-PDF. Suite 2/2 incl. a live selector.
   Adapted from anthropics/financial-services-plugins (Apache-2.0).
   Live pins refresh themselves on deploy since 2026-10-07 (boot refresh).
   Detail: `plans/DATASET_V2.md` PR-G.
   **PR-H deck renderer BUILT 2026-10-05** (branch `claude/pr-h-board-deck`,
   GitHub PR pending the user's review): the pack page is now a branded
   slide deck — teal cover, KPI tiles, live P&L waterfall / cash trend /
   AR+AP aging / exceptions-by-code charts from the governed views at the
   pack's lens, appendix + provenance slides, one landscape page per slide
   on print. Narrative stays as drafted; charts are live (stated on the
   provenance slide). Detail: `plans/DATASET_V2.md` PR-H.
4. **Company rename (PR-I) — BUILT 2026-10-10**: the demo company is now
   **Brightline Services plc** (user's choice; "Brightline Ltd" is a real
   UK company). Brand word, code `BRT`, invoice prefixes and the
   `brightline.example` domain all kept, so the rename was a name sweep +
   full regenerate/re-render of every committed document (dataset counts
   and the 54-plant map unchanged — the RNG never saw the name). seedCore
   now updates the company display name in place on deploy; skills/agent
   copy renamed → stale-pin refresh cycle runs itself on boot. Caveat:
   egress here blocked the Companies House register check for the NEW
   name — verify "Brightline Services" at
   find-and-update.company-information.service.gov.uk. Live agent release
   instructions keep the old name until a cold reset (release immutability);
   a dataset reload picks up the renamed documents.
5. **Phase 4c follow-ons** — saved views on a dashboard; data permissions
   (stubbed: every record-catalogue entity declares an `access` scope,
   enforcement designed in `plans/ANALYTICS.md` §3c). Core 4c built
   2026-10-03 incl. the record catalogue (`query_records` — the Analyst can
   scan actual records, not just the aggregate views).
6. **LRS lock/certify/supersede** — lands as the month-end dashboard's lock
   button + snapshot tables.
7. **Commentary quality — BUILT 2026-10-07** (`plans/R2R.md` §9):
   flux-commentary-style v2 + board-pack-method v2 (headline with both
   results and the % change, income-vs-expense split, drivers with two
   figures + % each, £500-or-5% materiality line, banned filler list);
   keyless fallbacks upgraded to the same bar; NEW eval assertion kinds
   grade the proposed command's CONTENT (`payload_contains`,
   `payload_not_contains`, `payload_min_money "<cmd>::<n>"` — bland
   output that names too few £ figures now FAILS the suite); close suite
   3/3 incl. a new mixed income/cost case, board-reporter 2/2, all
   auto-promoted through the boot refresh. Reasoning tier still only on
   eval evidence — the default tier passes the bar.
8. **Phase 6 remainder** — guided demo tour, cross-process dashboard.
   (Demo scenarios + mission control at `/admin/pipeline` built 2026-10-03:
   month-by-month processing, timed full-speed 10x run with remembered
   side-by-side, simulate-a-day — `plans/DEMO_SCRIPTS.md`.)
9. **Exceptions management M2 — BUILT 2026-10-10** (`plans/P2P.md` §10,
   `plans/O2C.md` §9): options carry display-only supplier email drafts
   (re-bill, short-pay, duplicate, corrected-invoice — never sent
   automatically, never on fraud-risk codes); tolerance policy is the
   `exception-tolerances` parameter set (2% or £25) read by the
   recommendation and shown on the workbench; per-kind option-family
   evals via the payload-grading assertion kinds (invoice-exception 9/9,
   cash-application 3/3 keyless); O2C mirror first slice: unmatched
   receipts open `ar_receipt` cases (new display-only `case.open`) with
   apply-residual / refund / hold-and-query options + draft letters,
   surfaced on /o2c as "Receipt queries". Seed now publishes skill text
   as a new version even over a UI-authored latest (no stranded
   curriculum updates). Remaining (M3): AR dispute mirror, per-supplier
   tolerances, model-path option evals as live cases.
10. **A2R — Acquire to Retire** (fixed assets: capitalise from P2P,
   depreciation as engine-derived period ticks, disposals) — low priority
   (MASTER_PLAN Phase 7).
11. **Phase 5 PM** — parked on user's call.

## Day log — 2026-10-04 (for a fast, safe pickup)

Shipped today, in order, all pushed and deployed: **PR-B** period lens
(month/quarter/YTD everywhere, user-verified) → **PR-C** dataset v2
(Jan–Sep, multi-page invoices incl. the AC-75726 trap, wrong IBANs +
`bank_detail_mismatch` and `total_mismatch` controls, poor scans, map
finalised; invariant now 1797=1797) → statements fit nine months +
loader runs in date order (user-reported, fixed) → **PR-D** scenario
windows + the hidden /test/plants answer sheet → **PR-E** chat-built
boards + chart house rules (§4.8 palette + accounting ticks;
user-reported same-colour lines + inconsistent axes, fixed).

Open when picking up (updated 2026-10-05):
1. **PR-E model-path defect FIXED 2026-10-05** — root cause was the
   `taskType` never passed to `buildSystemPrompt`; see the plan doc.
   Remaining: verify on LIVE (refresh stale pins, run analyst evals,
   retry the build-a-page prompt).
2. Live housekeeping Alec may not have done yet: a dataset reload for v2,
   the stale-pin refresh (playbook/extraction skill versions), and the
   transaction-generator manual promote.
3. Next build: **PR-F** home dashboard revamp (planned in
   plans/DATASET_V2.md).

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
