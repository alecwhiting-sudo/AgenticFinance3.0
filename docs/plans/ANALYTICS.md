# Analytics & Analyst Agent — Phase 4c plan

Status: **in progress** (M1 building). Scope decided here; MASTER_PLAN.md §4c is
the one-paragraph summary, this is the working plan.

## 1. The idea

Two layers, built in order:

- **M1 — curated views + charting.** A small catalogue of read-only,
  code-defined SQL views over what the ledger already knows (journal lines,
  invoices, bank transactions), each served by the API and rendered as a chart
  on a new `/analytics` page. Every figure drills to the rows behind it; every
  chart has a table view. No new measurement logic — derived aggregation only,
  same rule as `/erp/statements` (R2R plan §4).
- **M2 — the Analyst Agent + chat panel.** A persistent right-hand chat surface
  in the workbench. The user asks about trends, variances, "why did X move";
  the Analyst Agent answers with figures and the drill path. **Grounded by
  construction:** its only data tools are the M1 curated views — the model
  never writes SQL. Its context includes the data model, the architecture
  decisions (D1–D15) and the view catalogue. Read-only end to end; every
  answer cites the view and parameters it used.

## 2. M1 — the curated view catalogue

All views are plain SQL in `apps/api/src/routes/analytics.ts`, derived from
`erp.journal_line`/`erp.journal` (the measurement source of truth), plus the
open-item tables for aging. Money stays integer minor units end to end.

| View | What it answers | Shape | Chart form | Drill |
|---|---|---|---|---|
| `pl-trend` | How are income/expense lines moving month to month? | account × period movement | multi-line trend (per account) + total | `/ledger/{code}?period=` |
| `flux` | Why did the result move vs last month? | per-account delta, period vs prior | waterfall (diverging teal↔amber) | `/ledger/{code}?period=` |
| `ap-aging` | Who do we owe, how overdue? | supplier × bucket (current/1–30/31–60/61–90/90+) | stacked horizontal bars | `/p2p/invoices` |
| `ar-aging` | Who owes us, how overdue? | customer × bucket | stacked horizontal bars | `/o2c` |
| `counterparty` | Where does spend / revenue concentrate? | supplier or customer ranked totals + monthly series | ranked horizontal bars | `/p2p/invoices`, `/o2c` |
| `cash` | What is the cash position doing? | bank balance by day (cumulative) | area/line trend | `/payments` (reconciliation) |

Rules (from UI_CONVENTIONS §4.7, fixed):

- Charts are **our own inline SVG** — no charting dependency. The design
  system is minimal and the forms above are simple; a library adds weight,
  styling fights and a proxy'd install for no gain. Primitives live in
  `apps/web/src/components/charts.tsx` (trend, bars, waterfall, stacked
  h-bars) and are reused by 4c-adjacent pages later.
- Colour by job: sequential = accent teal ramp; diverging (flux waterfall) =
  teal (favourable) ↔ amber (adverse) with neutral grey midpoint; status badge
  tones are never series colours. Categorical series order is fixed
  (account-code order), not re-sorted per render.
- One axis per chart; thin marks; hover reveals exact figures (mono, minor
  units formatted by `money()`/`moneyCompact()`).
- **Every chart drills** (§1.2) and **every chart has a table view** — a
  Chart/Table toggle on each card, same data, no separate query.
- "Favourable/adverse" follows meaning, not sign: income up = favourable,
  expense up = adverse (same `goodWhen` idea as Kpi deltas).

API surface (all GET, read-only, no model calls):

- `GET /analytics/views` — the catalogue (id, title, question, dims, drill).
  This is also the Analyst Agent's tool menu in M2.
- `GET /analytics/pl-trend?year=` — monthly movement per P&L account.
- `GET /analytics/flux?period=` — per-account delta vs prior month.
- `GET /analytics/aging?side=ap|ar&asOf=` — open items bucketed by due date.
- `GET /analytics/counterparty?dim=supplier|customer` — ranked + series.
- `GET /analytics/cash` — cumulative bank balance by date.

Drill support: `/erp/accounts/:code` gains an optional `?period=YYYY-MM`
filter, and the ledger account page reads it, so a waterfall bar lands on
exactly the postings that made the move.

Navigation: `/analytics` as a child of Record to Report in the sidebar
("Analytics"), document-width is wrong here — charts get the full grid.

## 3. M2 — Analyst Agent + chat panel

- **Agent**: slug `analyst`, modelProfile `default` (Sonnet tier — judgement
  over schema-tight extraction; promote to `reasoning` only on eval evidence).
  Registered like every agent: release-pinned instructions + skills from the
  library. Skills: a `curated-views` skill describing the catalogue and when
  to use which view, and a `data-model` skill summarising schemas and D1–D15.
- **Grounding by construction**: the worker exposes exactly one data tool
  shape — `run_view(viewId, params)` — which calls the M1 endpoints. No SQL
  tool, no table access. If a question needs a view that doesn't exist, the
  honest answer is "the catalogue can't answer that yet", plus which view
  would be needed (that list feeds the catalogue's backlog).
- **Attribution**: every answer ends with the views + parameters used
  ("source: flux 2026-05 vs 2026-04; pl-trend 2026"), rendered as drill links
  in the panel.
- **Panel UX**: right-hand collapsible panel in the Shell (toggle in the top
  bar), persistent across navigation; conversation state client-side per
  session; questions become `analyst.question` work items through the normal
  queue; the panel polls the run for the answer. Read-only: the agent has no
  command grants beyond display-only `case.note`-class output — it can never
  post, pay or change anything.
- **Keyless behaviour**: without `ANTHROPIC_API_KEY` the fallback answers a
  few canned question shapes deterministically (biggest mover this month,
  overdue AR, cash position) and says plainly that free-text analysis needs a
  model key. No pretending.

## 4. Evals (M2, before promote)

Seed eval cases with known answers from the committed dataset: "biggest
expense increase in May" (deterministic from flux), "which supplier is most
overdue", "what's the cash trend since March". Grade: correct figure, correct
view cited, no invented numbers. Model promotion/downgrade follows the
standard release rule.

## 5. Out of scope (4c)

- Writing/altering data from the panel — never.
- Model-generated SQL — never (the catalogue grows by code review instead).
- Budget-vs-actual views (category_budget is P2P-lite; joins EPM phase).
- Saved/named analyses and scheduled commentary digests (post-4c).
- EPM-style driver models, forecasts (Phase 5+).

## 6. Build log

- M1 started: plan committed, analytics routes + charts + page next.
