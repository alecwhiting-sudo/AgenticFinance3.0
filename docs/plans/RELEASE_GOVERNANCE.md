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

**M1 — Eval isolation (build next; small).** Eval-originated proposals are
marked and never touch the books: work items carry `isEval`; the worker
passes it on `commands/propose`; the gateway validates schema+permission
fully but stores the command as `simulated` — never executes, never enters
the approvals inbox, excluded from all business queries. Eval grading reads
simulated commands exactly as it reads real ones today, so every existing
assertion keeps working. This alone removes the "testing in prod" defect.

**M2 — Shadow replay with an impact report (the real test environment).**
A Test-panel scenario: copy the books into a sandbox (or rely on replay
determinism to rebuild them), re-run a chosen slice of history (e.g. one
month's invoice intake and exceptions) under the DRAFT release, then diff
against the current release's actual outcomes and publish an impact report:
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
- **Control-regression check (deterministic):** diff the old and new skill
  texts' *Escalation & never-do* and *Method* sections; any removed
  prohibition, loosened tolerance or dropped escalation trigger is flagged
  red — a control change, which a human must explicitly accept.
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
