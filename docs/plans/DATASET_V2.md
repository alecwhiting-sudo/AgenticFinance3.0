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

### Known issue — RESOLVED 2026-10-05

**Root cause found (simpler than the conflict theory):** the board rule
was never in the live system prompt at all. `buildSystemPrompt` had been
given a `taskType` parameter, but the call site still read
`buildSystemPrompt(resolved)` — so the rule gated on
`taskType === "analyst.question"` never attached, and the model only ever
saw "you act only through your tools … abstain", which is exactly what it
echoed. The conflict risk was real too, so all three logged candidates
shipped:
1. the call site passes `taskType` (the actual bug);
2. the generic abstain rule now distinguishes ACTIONS from PROPOSALS
   ("proposing is not acting — a board: line is text in your summary,
   always in scope, never a reason to abstain");
3. the board convention moved into the governed home: the
   **curated-views skill** gained a "Building pages" section (seed v3 →
   stale pin → refresh → suite green → auto-promoted; the active analyst
   release now pins v3), with "never abstain from a build-a-page request"
   in its Escalation section.
Verified locally: keyless proposal + create + render green, analyst suite
3/3, 30 unit tests. The MODEL path is verified on live by (a) the analyst
eval suite there (the board case asserts `summary_contains "board:"` on
the model) and (b) re-running the exact prompt. The lesson stands in the
governance plan: a keyless-green eval is not evidence for the model path.

Original record of the defect (kept for the audit trail):
### ⚠ KNOWN ISSUE (2026-10-04, as logged)

**The model-path Analyst abstains instead of proposing the board.** Alec
ran the exact prompt on live ("Build me a page called Cash focus with the
cash position and AP aging") and got outcome **abstained**: *"I can't build
or save a workbench page … I'm read-only and have no page-creation tool"*
— followed by a perfectly good text answer of both figures.

**Diagnosis (high confidence, unverified):** instruction conflict inside
the worker's system prompt (`apps/worker/src/runtime/agentLoop.ts`,
`buildSystemPrompt`). The generic operating rule — *"You act only through
your tools … such requests are out of scope — finish with outcome
'abstained'"* — plus the analyst release's own *"read-only"* framing
outweigh the board rule appended lower down. The refusal wording mirrors
the operating rule almost verbatim, which is the conflict signature. The
board rule asks for NO tool (it's one line of summary text), but the model
pattern-matched "build a page" to "action I have no tool for". Secondary
possibility to rule out first: the worker deploy had not restarted when
the prompt ran (the rule ships worker-side) — reproduce once on the
current deploy before changing anything.

**Why evals didn't catch it:** the keyless fallback composes boards
deterministically, so the analyst suite (3/3) passes without exercising
the model's reading of the conflicting rules. The eval was green while the
behaviour it stands for was not. That is itself a finding for the
governance story: this case needs to run on the MODEL path to mean
anything (there is no model-path eval environment locally — it would run
on live, where the key exists, via the normal eval suite).

**Candidate fixes for the next session (decide then, not now):**
1. Reword the generic abstain rule so it applies to ACTIONS, not
   proposals: "proposing content for a human to confirm is always in
   scope". Smallest diff, worker-side, applies everywhere at once.
2. Move the board convention out of the late operating-rules block and
   into the analyst's release instructions / curated-views skill (a new
   skill version → stale pin → governance refresh promotes it). More
   architecturally honest: behaviour lives in the release, not the
   harness; and the eval gate then actually governs it.
3. Both — 1 removes the conflict, 2 puts the behaviour where it belongs.
Also do: re-run the live analyst eval suite AFTER the fix (it runs the
model path there) and re-test the exact prompt above; consider an
assertion like `summary_contains "board:"` on a *live* run, since the
keyless pass is not evidence for the model path.

**What is NOT broken:** the whole human-confirmed pipeline downstream is
verified — `board:` line parsing, the preview + "Create this page" button,
POST /analytics/boards validation, the /analytics/boards/{slug} renderer,
the lens, and the chart house rules. Only the model's willingness to emit
the proposal line is at issue.

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

## PR-G — Board Pack Agent (ported from Claude finance skills) · **BUILT 2026-10-05**

As built (jumped the queue on Alec's call), beyond the spec below:
- **The known place**: R2R → Board packs (/reports/board). Draft control =
  grain toggle (month/quarter/YTD) + period select; every pack persists as
  a `core.board_pack` row with a status — a "drafting…" pack carries on if
  you leave the page and is waiting on return (the page says exactly that);
  failed drafts surface as failed with a re-draft hint, never stuck.
- **Eval-driven improvement loop made visible**: both pages carry "Not
  happy with a pack? → edit the Board pack method skill (new versions pass
  the eval gate), draft again — the old pack stays for comparison."
- **Governance**: board-reporter agent (r2r, default tier) proposes ONE
  display-only `report.board_pack.save`; packs are book-scoped (D16), and
  eval runs save into test-book rows (the gateway creates them there), so
  the real list never sees eval packs — verified: suite 2/2 (manufactured
  + live latest-complete-month selector) with both eval packs in book
  'test'. Keyless fallback composes the five core sections from real view
  figures, so demos and evals stay green without a key.
- **Product**: five sections (exec summary with headline figure tiles, P&L
  movers, cash, working capital, controls & exceptions incl. fraud holds —
  the differentiator), sources line as audit trail, print stylesheet +
  "Print / save as PDF" (browser print; headless-rendered PDF deferred).
- Verified locally end-to-end: Q3 2026 and YTD Sept packs drafted from the
  real books in seconds; model path verifies on live via the eval suite
  (lesson applied: the live case asserts command_proposed on the model).
- **Boards "canvas" question answered**: no new architecture needed — each
  chat-built board already IS a persistent page at /analytics/boards/{slug},
  listed on /analytics. Follow-on idea (not built): "promote a board to a
  named standard report" surfacing chosen boards in the R2R nav.

Original feasibility note:

User ask: can we include "the Claude finance skills board report generator"?
**Feasibility: YES — as a port, not an install.** Researched 2026-10-05:
Anthropic's finance team runs an internal Board Reporting agent (not
published); the open-source `anthropics/financial-services-plugins` repo
(Apache-2.0) has no literal board-report skill but carries the ingredients
— Month-End Closer (variance commentary), `pptx-author`/`xlsx-author`
(headless deck/Excel), `deck-refresh`, SKILL.md packaging. Their packaging
targets Claude Code / Cowork / Managed Agents, NOT our worker runtime — so
nothing installs directly, but the skill CONTENT and output pattern port
cleanly under Apache-2.0 (attribute in the skill notes).

Why the fit is high — we already have the hard parts:
- the governed data surface (curated views + query_records + statements)
  plays the role of their data connectors;
- Close Agent flux commentary = their variance commentary;
- our versioned, eval-gated skills library = their SKILL.md (adapted);
- chart house rules + the boards renderer = the pack's visuals;
- headless Chromium (invoice rendering) = the PDF path;
- propose→human-confirm (boards, options) = the approval posture a board
  pack needs ("drafts analyst work product for human review" — their own
  disclaimer, same as our finance safety rule).

Build shape (one PR, ~M-L):
1. **Skill**: "Board pack method" (category fpa) — 7-heading template;
   method adapted from the Apache-2.0 material + our own close/commentary
   skills: exec summary with the period lens (month/quarter/YTD), P&L vs
   prior with flux reading, cash + runway, working capital (AR/AP aging,
   overdue concentrations), controls & exceptions section (open cases by
   code, fraud holds — our differentiator), strictly actuals (no forecast
   until FP&A lands). Never-do: no invented figures, every number cites
   its view, nothing sent anywhere without approval.
2. **Agent**: board-reporter (process r2r, modelProfile default; promote
   to reasoning only on eval evidence). Tools it already has access
   patterns for: run_view, query_records, + a small `get_statements`
   read tool (the /erp/statements payload). Output: proposes a
   `report.board_pack.save` display-only command (like commentary) with
   structured sections; human reviews in the workbench.
3. **Renderer**: /reports/board/[period] — HTML pack (cover, sections,
   charts via the shared primitives, commentary blocks) with print CSS;
   "Download PDF" via the existing Chromium path. pptx deferred — port
   `pptx-author` later only if a deck is demanded (PDF pack first).
4. **Evals**: manufactured case (fixed figures → sections present, every
   number traceable, no invented data) + a live case (latest complete
   month → pack drafts without error, sources cited). Model-path verify
   on live (lesson from the boards defect).
5. Later options from the same repo worth noting, not building now:
   due-diligence data packs, earnings-analysis patterns for supplier/
   customer reviews, xlsx-author for an Excel annex.

Dependencies: none hard; nicest after F. Licence: Apache-2.0 with
attribution noted in the skill's notes field.

## Sequence summary

| # | Package | Size | Depends on | Status |
|---|---|---|---|---|
| A | Test data map (existing) | docs | — | ✅ built |
| B | Period lens | M | — | ✅ built |
| C | Dataset v2 + IBAN control | L | drift guard | ✅ built |
| D | Scenario windows + /test/plants | S–M | C | ✅ built |
| E | Chat-built dashboards + chart house rules | L | B (lens) | ✅ built |
| F | Home dashboard revamp (live motion) | M | — (shares primitives with E) | planned |
| G | Board Pack Agent (ported from Claude finance skills, Apache-2.0) | M–L | — | ✅ built (jumped queue) |
