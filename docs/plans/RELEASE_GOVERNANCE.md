# Release governance — testing agent changes before they reach the books

Status: **planned** (decision recorded 2026-10-04; M1 is the next build in
this area). Trigger: the stale-pin refresh made skill rollouts one click, and
the question "did we just enable prod changes without offline testing?" is
fair — partly yes.

## 1. Honest statement of today's position

What we have (keep all of it — it is the inner gate):
- Immutable skills and releases; behaviour change = new release.
- Eval suites gate promotion; the refresh flow evals the DRAFT release and
  auto-promotes only a fully green suite, attributed to the harness.
- A two-step reviewed refresh naming agents, consequence surface and gate
  strength; agents only ever PROPOSE — humans approve anything that moves
  money, posts, or leaves the building.

The gap: **eval runs execute against the live database.** The gateway does
not know a proposal came from an eval case, so:
- commands under standing authority (auto-band purchases) actually execute
  during an eval;
- commands needing approval appear in the human inbox as noise;
- eval work items share the production queue with real work.

Acceptable for a demo whose data is disposable and replayable; not
production practice, and it would fail an ITGC change-management review
(no environment separation, test evidence created in prod).

## 2. What current practice says (reference points)

- **ITGC / change management:** dev → test → prod separation; the person
  who builds is not the person who approves; documented test evidence
  before promotion. Our release model already gives build/approve
  separation and evidence (eval runs); environment separation is the
  missing leg.
- **LLM-agent practice:** golden-set offline evals (we have), **shadow
  mode** (run the candidate on real inputs without letting it act),
  **backtesting** on historical data, canary/staged rollout, post-deploy
  monitoring with rollback. Our D13 replay determinism makes backtesting
  unusually cheap: history can be re-run under a candidate release and
  DIFFED against what the current release did.

## 3. The plan, layered (keeps everything already built)

**M1 — Eval isolation — BUILT 2026-10-04 as BOOK CODES (D16), superseding
the "simulated commands" design.** The better frame (Alec): the deployment
is one environment, but the ledger carries a `book` dimension — `main` for
the real books (future: ifrs/local GAAP books), `test` for eval-originated
work. Eval commands execute the FULL pipeline (gateway, posting, movements,
subledgers) into `book=test`; the gateway derives the book from the run's
work item so callers can't spoof it; statements, trial balance, analytics,
queues and the approvals inbox all read `book <> 'test'`. Consequence:
evals are safe to run IN the live environment as a standing assurance
control (continuous re-testing of live releases), which is stronger than
suppressing execution — the posting path itself stays tested.

**M2a — Live-data eval cases — BUILT 2026-10-04.** Eval cases may now carry
`input.live` naming a selector resolved against the real books at run time
(`services/evalSuite.ts`): `oldest_open_exception` (graded exactly as the
workbench would queue it) and `most_overdue_ar_invoice`, growing as
coverage demands. Live cases assert invariants (`outcome_in`,
`command_proposed`) rather than fixed answers, execute in `book=test`
(D16), and a case with no matching record is recorded as skipped-passed so
absence of data never fails a suite. Seeded: invoice-exception and
collections each carry one. The full-population version is M2.

**M2 — Shadow replay with an impact report — BUILT 2026-10-10.** Lives on
the agent page beside the release pipeline (not the Test panel — the report
belongs next to the promote decision it informs). "Run shadow replay" on a
DRAFT release re-queues the agent's real recent work items (latest run per
item, up to 25, evals excluded) as `shadow.case` items pinned to the draft;
the gateway books every command into the test book (D16), display-only case
commands skip the real case timeline, `report.commentary.save` skips the
shared commentary table, and a replayed board pack writes a test-book COPY
— nothing human-visible moves. The worker diffs each shadow run against its
original (outcome, proposed command set, chosen resolution) and closes the
replay with the impact report: cases replayed, cases that would change
(case-by-case with links to both runs), changes by exception code,
escalation rate and model calls/cost (rate card) baseline → draft.
Baseline commands are read from the original run's TRANSCRIPT (demo resets
prune proposed command rows); a baseline with no recoverable commands is
reported "incomparable", never "changed". Verified keyless: 25
invoice-exception cases replayed in ~5s; an identical-behaviour draft
correctly measured 15 adds-options-now deltas vs pre-options history and
zero resolution changes.
Original design sketch (kept for context): re-run a chosen slice of history
under the DRAFT release, then diff against the current release's actual
outcomes and publish an impact report:
- exceptions raised, by code (more? fewer? which ones changed);
- resolution recommendations that changed, listed case by case;
- postings coded differently; escalation/abstention rate; cost per
  completed case (D14/D15 numbers).
This answers "what will this skill change DO" with measurement, not
prediction. It is the offline test environment, built from machinery we
already have (loader, replay, runs[] side-by-side memory).

**M3 — AI release review (the gut-call, made rigorous).** A release-review
step on every draft, shown on the preview and the release page before
promotion:
- **Control-regression check (deterministic) — BUILT 2026-10-04 (M3a):**
  `lib/skillDiff.ts` diffs the pinned vs latest text's *Escalation &
  never-do* and *Method* sections per changed skill; removed operative
  lines flag red on the refresh preview and the Confirm button stays
  disabled until the human ticks "I have read these and accept the control
  changes". Pre-template pinned versions flag as "not comparable — read the
  full text". Rewording can flag too; that is the accepted cost (nothing
  loosens silently). Verified: a doctored version dropping the
  bank_detail_change prohibition was flagged line-by-line and blocked the
  confirm.
- **Model review (reasoning tier, per the routing table):** reads old text,
  new text, the diff, and — critically — the M2 impact numbers when they
  exist, and writes a structured opinion: expected behaviour change,
  robustness vs before, control impact, recommendation. Grounding rule: an
  AI prediction without M2 measurements is labelled as such ("predicted,
  not measured"); with M2 it must reconcile its claims to the measured
  diff. The review is advisory — it never promotes or blocks by itself;
  it changes what the human sees at the promote decision.
- Rationale for the order: measurement (M2) beats prediction (M3) — the
  reviewer's job is to interpret measurements and catch control
  regressions, not to replace testing.

**M4 — Production phase (deferred with Phase P):** a genuine second
environment (separate Railway project/database) receiving candidate
releases first; staged rollout (a fraction of work items routed to the new
release) with automatic fallback on error-rate or escalation-rate
regression. Not demo work.

## 4. Sequencing & effort

1. M1 eval isolation — small (gateway flag + worker passthrough + queue
   filters); do before any further skill editing habit forms.
2. M3a control-regression diff — small, pure code; lands on the refresh
   preview.
3. M2 shadow replay — medium (a day-scale build); reuses loader/replay.
4. M3b model reviewer — small once M2 exists (it reads M2's output).
5. M4 — production phase.

## 5. What this preserves

The one-click refresh stays. It becomes: preview → baseline evals →
isolated eval suite on the draft → control-regression diff → (optionally)
shadow replay impact report → AI review attached → green gate → promote.
Same button, more armour behind it.
