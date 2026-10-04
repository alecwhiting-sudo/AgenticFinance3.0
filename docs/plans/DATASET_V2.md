# Dataset v2 + period lens + chat-built dashboards — the PR sequence

Status: **planned 2026-10-04** — nothing here is built yet except PR-A (the
test data map document). Companion doc: `plans/TEST_DATA_MAP.md` (the flaw
catalogue this plan extends).

The user's asks, restated: run the demo for every month up to September
(needs Jan–Mar data + documents); six-month scenario windows (Jan–Jun or
Apr–Sep); manufacture edge-case documents to catch out the extraction
agents (5 multi-page invoices, incorrect IBANs, poor-quality scans); a test
data map of planted flaws AND the crap already in the data; chat-built
custom analytics pages; and a period lens (month / quarter / YTD) across
reporting, analytics, trial balance and financial statements. Everything
ships as sequenced, PR-sized pushes to the working branch — one package =
one reviewable, deployable commit (or small commit set).

## Why this order

- **The map first** (PR-A): it's pure documentation of what already exists,
  zero risk, and it's the contract the dataset work is built against.
- **Period lens before more data** (PR-B): nine months of data without a
  month/quarter/YTD selector is *less* usable than six months — the lens is
  what makes the volume increase navigable. It's also independent of the
  Studio, so it can't be destabilised by dataset churn (and vice versa).
- **Dataset v2 as one package** (PR-C): the Jan–Mar extension, the edge-case
  documents, the supplier bank-details schema change and the new
  `bank_detail_mismatch` control are one coherent change — splitting them
  would ship a dataset whose planted flaws nothing catches.
- **Scenario windows after the data exists** (PR-D): a Jan–Jun run needs
  January data to run.
- **Chat-built dashboards last** (PR-E): biggest and most novel; depends on
  nothing above, but the four earlier packages each unblock demo value
  sooner.

## Do-first prerequisites (before PR-C touches the Studio)

1. **Drift guard:** regenerate dataset v1 from the committed Studio at seed
   20261001 and diff against `packages/db/seed/generated/` — must be
   byte-identical before the generator is extended. If it isn't, fix the
   drift first (that's a bug today, not a v2 task).
2. **Supplier master has no bank fields** (schema: code, name, email,
   paymentTermsDays) — the IBAN flaw is impossible to *detect* until the
   master holds the true IBAN. The schema change (migration) is step one
   inside PR-C, not an afterthought.
3. **Invariants will change:** "1159 events = 1159 journals" is cited in
   docs, tests and Test-panel copy. PR-C must sweep every citation to the
   new v2 numbers in the same commit (grep for `1159`).

---

## PR-A — Test data map (existing flaws) · **done, this commit**

`docs/plans/TEST_DATA_MAP.md`: §1 the 36 planted v1 exceptions (what each
simulates, which control catches it, where to watch); §2 known quirks
(scan PDFs, uneven formats by supplier, clean-by-design AR, non-settlement
bank lines, today-dated drips, the test book, no supplier bank details);
§3 the planned v2 additions. Updated in the same commit as any dataset
change from here on.

## PR-B — Period lens (month / quarter / YTD) · **BUILT 2026-10-04**

One shared period model, applied everywhere figures are shown.

- `packages/shared`: `PeriodLens` schema — `{ grain: month|quarter|ytd,
  period: string }` (e.g. `2026-09`, `2026-Q3`, `ytd@2026-09`) resolving to
  `{ from, to }` month-code bounds; FY = calendar year for the demo.
- API: the read surfaces accept `from`/`to` (or a `lens` param) instead of
  single `period`: trial balance, P&L, balance sheet (as-at `to`), account
  drill, analytics views (trend charts keep monthly granularity inside the
  window; flux compares window vs prior window of same length), AP/AR aging
  (as-of `to`).
- Web: one `PeriodPicker` component (grain toggle + period select) in the
  page headers of /reports, /ledger (TB), /analytics, account drill;
  selection persisted (localStorage) and carried in the URL so links share
  the lens.
- Analyst: `run_view`/`query_records` gain the same window params so chat
  answers honour the lens the user is looking at.
- No schema change; book filters unchanged. Risk: low. Size: medium.

## PR-C — Dataset v2 (Jan–Mar + edge-case documents + IBAN control) · **BUILT 2026-10-04**

As built, beyond the spec below: a second intake control landed with it
(`total_mismatch` — stated totals must equal the line sum, which is how the
trap is caught); the fiscal calendar now starts 2026-01 (15 periods);
keyless playbook paths and five new eval cases cover both new codes; the
exact planted invoice numbers are in `plans/TEST_DATA_MAP.md`. New
invariant: fresh load = **1797 events = 1797 journals**, balance 0, zero
planted-vs-derived mismatches.

Studio changes (`packages/studio`), all deterministic, same seed
discipline (new seed constant for the extension so v1 months regenerate
identically):

1. **Jan–Mar 2026 extension**: ~150 more AP chains, ~200 AR invoices,
   ~250 bank lines pro-rata, same exception taxonomy at the same ~12% rate.
   Existing Apr–Sep records byte-identical (append, never reshuffle the
   RNG stream for v1 months).
2. **Multi-page invoices ×5** (services itemised across 2–4 pages):
   - 2 with per-page subtotals + a grand total on the last page;
   - 2 with a grand total only on the last page;
   - 1 **trap**: per-page subtotals that do NOT sum to the stated grand
     total — correct behaviour is an exception, never a silent pass.
   Rendered as PDFs by the Studio renderer; mixed into the drip stream.
3. **Supplier bank details**: migration adds `iban`/`bank_name` (or a
   `bank_details` block) to the supplier master; Studio seeds true IBANs.
4. **Incorrect IBAN ×4–6**: invoice IBAN differs from the master. New
   intake check in `invoiceIntake` → new exception code
   `bank_detail_mismatch`, held for human resolution like
   `bank_detail_change` (C-P4 family); exception-playbook skill gains the
   code (new version via the seed upgrade path); eval cases assert the
   agent abstains/escalates.
5. **Poor-quality scan tier**: ~10 scan PDFs rendered with skew/noise/low
   contrast; extraction failures must escalate, not guess.
6. **Extraction eval cases** for the multi-page shapes (all lines captured,
   totals reconcile, the trap raises an exception).
7. **Bookkeeping**: dataset version stamp v2; TEST_DATA_MAP.md §3 → §1 with
   exact invoice numbers; invariant sweep (the `1159` citations), Test-panel
   copy, STATUS. Risk: medium-high (touches intake + schema + Studio).
   Size: large — may land as 2–3 commits (schema+control, then data, then
   docs/evals) but one package.

## PR-D — Scenario windows + the in-app answer sheet · **BUILT 2026-10-04**

- Loader `monthRange` mode: wipe, then load ONLY [from..to] months;
  payments dated beyond the window stay unpaid (honest open AP at the
  edge). `/admin/reset` mode `window` with from/to.
- Test panel: "Six-month windows" scenario — Jan–Jun and Apr–Sep presets
  plus a custom from/to picker. Verified: Jan–Jun = 1169 journals,
  balance 0, months 2026-01..06 only, 83 open AP at the window edge.
- **/test/plants** (deliberately NOT in the navigation — reached from the
  Test panel): the live test data map. Every planted flaw with invoice
  number, supplier, date, amount, arrival format and the control that
  catches it, served by `GET /admin/dataset/plants` which derives it from
  the committed dataset at runtime — it can never drift from the data.
  Multi-page and poor-scan challenges have their own sections; the trap
  row is highlighted.

## PR-E — Chat-built analytics dashboards · **BUILT 2026-10-04**

As built, two deliberate deviations from the spec below:
- **No `dashboard.compose` command.** Creation is human-confirmed instead:
  the Analyst ends its answer with a `board:` JSON proposal (grounded on
  the view catalogue), the panel renders a preview + "Create this page"
  button, and the click POSTs `/analytics/boards` (Zod-validated, activity-
  logged). Cleaner governance — agents propose, humans approve — and no
  release-permission change needed on the live Analyst.
- **Chart house rules landed with it** (user feedback 2026-10-04: same-
  colour trend lines, inconsistent axis labels): UI_CONVENTIONS §4.8 — a
  six-slot categorical palette validated with the dataviz six-checks script
  on both card surfaces (`--s1..--s6`), colour-by-job (categorical =
  identity, teal ramp = ordered segments only, teal↔amber = diverging),
  and ONE tick formatter everywhere with accounting parentheses for
  negatives. The board renderer uses the same primitives, so chat-built
  pages inherit the rules by construction; a person can override per board.

Original spec:

Describe tiles in the Analyst chat → a page gets built.

- Schema: `analytics.dashboard` (slug, title, tiles JSON: each tile =
  curated view ref + params + chart form + span) — tiles reference ONLY
  the view/record catalogue, so every chat-built page stays grounded and
  book-filtered by construction.
- Gateway: new display-only command `dashboard.compose` (Analyst proposes;
  auto-executable — it moves no money — but logged like every command).
- API: CRUD + `GET /analytics/boards/:slug` resolving tiles to data.
- Web: `/analytics/boards/[slug]` renderer reusing the chart primitives;
  boards listed on /analytics; the Analyst panel recognises "build me a
  page with…" and proposes the composition back for one-click confirm.
- Honours the PR-B period lens. Risk: medium. Size: large. Independent of
  C/D — can be pulled earlier if wanted.

## PR-F — Home dashboard revamp: live motion over static totals · **planned**

User observation (2026-10-04): the home dashboard barely moves while whole
months are being processed — static master-data tiles (accounts 21,
suppliers 40, customers 60, items 5) say nothing once you've seen them
once. Principle: every tile should either MOVE when the business moves or
answer a question a CFO actually asks; master-data counts belong in Admin.

- **Money KPIs instead of master counts**: cash position (with a
  sparkline), this month's result (period lens aware), AP due in 7 days,
  AR overdue — each drilling to its page. All book-filtered, all live.
- **Motion row**: invoices processed today, straight-through rate (% of
  captures with zero touches), open exceptions with a delta since
  yesterday, model spend today vs the deterministic volume it rode on.
- **A working pipeline is visible from the front door**: when a load/run
  is active, show the live throughput strip (reuse the mission-control
  lanes + items/min ticker) right on the dashboard; counters tick on SSE
  activity events instead of waiting for a reload.
- **Agent roster with a pulse**: working/idle state per agent (claimed
  work items), last action one-liner, runs + cost today — not just
  release numbers.
- Honesty rules carry over: no vanity metrics, every figure drills to its
  source, "to date" labelling for the in-progress month.
- Size: M. Depends on nothing; best after E so chat-built tiles and the
  dashboard share primitives.

## Sequence summary

| # | Package | Size | Depends on | Status |
|---|---|---|---|---|
| A | Test data map (existing) | docs | — | ✅ built |
| B | Period lens | M | — | ✅ built |
| C | Dataset v2 + IBAN control | L | drift guard | ✅ built |
| D | Scenario windows + /test/plants | S–M | C | ✅ built |
| E | Chat-built dashboards + chart house rules | L | B (lens) | ✅ built |
| F | Home dashboard revamp (live motion) | M | — (shares primitives with E) | planned |
