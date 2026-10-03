# UI Conventions — design doctrine for the workbench

**Status:** v1 · **Companion to:** `ARCHITECTURE.md` (§6 information architecture,
§6a live experience layer) and `plans/P2P.md` · **Applies to:** `apps/web`
(Next.js, Tailwind v4, CSS-variable tokens in `src/app/globals.css`, shared
primitives in `src/components/ui.tsx`).

This document is doctrine, not a style guide appendix: it says what we do and
why, so that every new screen lands consistent without a design review. Where a
rule already exists in code or in ARCHITECTURE §6a, we cite it rather than
restate it differently.

The one-sentence thesis: **we are building a finance tool with ERP-grade
discipline and fintech-grade feel** — the control surface of Workday with the
calm, craft and speed of [Linear](https://linear.app/now/behind-the-latest-design-refresh),
[Ramp](https://www.g2.com/products/ramp-financial-ramp/reviews) and
[Mercury](https://www.themasterly.com/blog/fintech-design-guide) — plus one
genuinely new layer: agents as visible, managed staff.

---

## PART 1 — ERP/finance UI conventions

### 1.1 Information architecture and the navigation protocol

ERP UX fails first at navigation: too many clicks, inconsistent journeys,
screens users can't find again ([UXPA on ERP software](https://uxpamagazine.org/erp_software_revisited/?lang=en),
[why enterprise B2B UI stays poor](https://medium.com/@bayu.alpiansyah/why-erp-and-b2b-saas-products-continue-to-struggle-with-poor-ui-design-d627d4341606)).
Our protocol:

1. **Global nav is for areas, object pages are for things.** The top bar
   (`src/app/layout.tsx`) lists areas — Dashboard, Agents, P2P, Ledger, Work,
   Approvals (R2R/O2C/EPM join later per ARCHITECTURE §6). Everything else is
   reached by drilling from an area or jumping directly. We never add an
   object type to the global nav; we add an area at most once per phase.
2. **Every entity gets a canonical page with a stable, guessable URL.**
   `/p2p/purchases/[id]`, `/runs/[id]`, `/agents/[slug]` already follow this;
   suppliers, invoices, journals, cases, releases, skills and commands must
   too. If something has an ID in Postgres and a human will ever ask "show me
   that one", it has a page. URLs are share-in-Slack artifacts: an approval
   discussion should be a link, not a screenshot.
3. **Breadcrumbs on every object page**, rendered from the ownership chain
   (P2P › Purchases › PO-2026-0142), each segment a link. Objects are reached
   from many directions (feed, inbox, search, drill-down); breadcrumbs are the
   cheap answer to "where am I" that ERPs famously lack.
4. **Command palette (⌘K) as the universal jump.** Fuzzy-match entity numbers,
   supplier names, agent names, nav destinations, and a few verbs ("drip demo
   items", "new purchase"). Build on [cmdk via shadcn's Command](https://shadcnstudio.com/docs/components/command)
   — this is the single strongest "pro tool" signal borrowed from
   [Linear's keyboard-first model](https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/),
   and in a demo it reads as mastery: type an invoice number, land on it.
5. **Keyboard conventions:** `⌘K` palette; `j/k` row movement in any list;
   `Enter` opens; `Esc` closes any peek panel; `a`/`r` approve/reject when the
   approvals inbox has focus (with confirmation per §2.4). No other global
   bindings — a small reliable set beats a large forgotten one.

### 1.2 Drill-down doctrine: every number is a door

The single best idea in Workday Financials is that reports drill to
transaction level ([Workday reporting docs](https://doc.workday.com/workday-education/en-us/course-manuals/advanced-workday-reporting-for-financials/workday-reporting-for-finance.html));
modern FP&A tools like [Pigment sell the same move](https://www.pigment.com/newsroom/virgin-voyages-selects-pigment-to-modernize-financial-planning)
as their headline feature. We adopt it as an invariant:

- **No dead-end numbers.** Every KPI tile, stage count, badge count and total
  is a link to the filtered list that produced it; every list row opens the
  record; every record links its documents, journals and case. The chain is
  always *aggregate → list → record → evidence*. The P2P stage tiles
  (`src/app/p2p/page.tsx`) currently display counts without linking — that is
  a violation, not a style choice (fix in Part 3).
- **Trial balance → account → journal lines → journal → source document.**
  The ledger is the deepest drill path and the best demo proof that "no
  journal exists without a source" (MASTER_PLAN §8). Each hop is one click.
- **Peek vs navigate, one rule:** a **peek** (right-side panel, `Esc` to
  close, URL untouched) is for *triage within a list* — scanning queue items,
  previewing an invoice from the exceptions list. **Navigate** (full page, URL
  changes) is for *work on the object* — anything you'd act on, share, or
  stay with longer than ~10 seconds. A peek always contains an "Open →" link
  to the canonical page. Never nest peeks; a click inside a peek navigates.
- **Filtered lists encode their filters in the URL** (`?status=exception`),
  so drill-downs are bookmarkable and the back button works. Back must always
  work; this is the cheapest anti-"iframe feel" measure there is.

### 1.3 Tables and lists

Tables are the workhorse surface of a finance tool; we follow
[enterprise data-table UX practice](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)
and the [data-table reference guides](https://www.setproduct.com/blog/data-table-ui-design)
with these fixed decisions:

- **Density:** one density, compact-but-readable — `text-sm`, `py-1.5`/`py-2`
  rows, generous page whitespace *around* the table (§6a: "dense-but-
  breathable"). No density toggle until a real user asks; options are debt.
- **Structure:** single subtle row separator (`var(--border)`), no vertical
  gridlines, no zebra striping — whitespace carries the columns
  ([UI Prep table guide](https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables)).
  Full row is the click target; hover tints the row with a 4% accent mix.
- **Column conventions:** text left-aligned; **all numbers and money
  right-aligned in tabular numerals** (`tabular-nums`, already our habit —
  keep it total); dates right-ish before the number block; status badge in a
  fixed-width column so rows don't wobble. Identifier column (PO number,
  invoice number) is the link, rendered medium-weight.
- **Money formatting:** GBP from integer pence via one shared `formatMoney`
  helper (currently a `gbp` lambda copy-pasted per page — consolidate into
  `src/lib/format.ts`); two decimals always; thousands separators;
  **negatives in parentheses** `(£1,234.00)`, the accounting convention,
  never a bare minus in financial columns; zero rendered as `£0.00`, never
  blank (blank means "unknown", zero means "zero").
- **Status badges:** the `Badge` + `toneForStatus` system in
  `src/components/ui.tsx` is the only way status appears — one vocabulary of
  four tones (good/warn/bad/neutral) across ERP and agent screens. New
  statuses get a `toneForStatus` entry, never a bespoke colour. Status words
  come verbatim from the state machines in `plans/P2P.md` §2; the UI never
  invents friendlier synonyms, because the demo narrates those exact states.
- **Filters and saved views:** filter chips above the table, mirrored to the
  URL. Saved views are Phase 6 at the earliest; until then, "saved view" =
  a bookmarked URL, which the URL discipline above makes genuinely workable.
- **The three-state rule:** every data region renders exactly one of
  *loading* (skeleton matching final layout, zero shift —
  [skeleton practice](https://balevdev.medium.com/skeletons-the-pinnacle-of-loading-states-in-react-19-427cbb5a1f48)),
  *empty* (one calm sentence + the action that fills it), or *populated*.
  We already distinguish **unreachable vs empty** — the amber "API down —
  blank, not zero" banner in `src/app/p2p/page.tsx` — and we keep that
  distinction everywhere: a finance tool that shows £0 when the backend is
  down is lying, and lying about money is the one unforgivable UI bug.

### 1.4 Record page anatomy

Every canonical object page has the same skeleton, so users stop reading
layouts and start reading data. The Purchase page
(`src/app/p2p/purchases/[id]/page.tsx`) is the reference implementation:

1. **Header:** identity (number + name), status badge(s), one-line context
   sentence, breadcrumbs above, and **primary actions top-right** (the
   Purchase's "Supplier view ↗" slot). At most two buttons; everything else
   goes in a "⋯" overflow — our version of Workday's
   [related-actions menu](https://uvafinance.virginia.edu/sites/uvafinance/files/2022-05/UVAFST_QRG_WorkdayNavigation.pdf).
2. **The thread/timeline:** the chronological story of the object — request,
   approval, receipts, invoices, agent actions, human decisions — exactly as
   the Purchase thread renders today. Timeline entries that reference other
   objects link to them. Agent actions appear inline with an agent chip, so
   human and agent work interleave in one narrative (this *is* the
   `evidence.case` timeline from ARCHITECTURE §3, rendered).
3. **Related objects:** cards/tables for owned and referencing objects
   (lines, receipts, invoices, journals, cases), each row drillable.
4. **Documents panel:** every attached document (PDF, email, rendered
   supplier view) listed with type and date, opening in a peek viewer.
   Evidence must be one click from the record — it is the demo's proof layer.

### 1.5 Look and feel

Codified from what exists (`globals.css`) plus ARCHITECTURE §6a:

- **Calm, dense-but-breathable.** Small type (body `text-sm`, page titles
  `text-2xl` max), lots of whitespace between sections, tight within them.
  Hierarchy comes from weight and muted-vs-foreground colour, not size — the
  [Linear refresh](https://linear.app/now/behind-the-latest-design-refresh)
  lesson: supporting chrome recedes, the user's data stays in focus.
- **One accent.** Teal (`--accent`), used only for *meaning*: live/active
  states, links on hover, the breathing pulse, primary actions. Red/amber
  exist solely inside the badge-tone system. A screen with more than one
  accent-coloured thing competing is wrong. This restraint is what makes
  [Mercury read as a premium product](https://www.themasterly.com/blog/fintech-design-guide)
  rather than a dashboard template.
- **Light/dark via CSS variables only** (`:root` + `prefers-color-scheme`
  block in `globals.css`). Components never hardcode hex except the two badge
  semantic colours (move those into tokens — Part 3). Charts follow the
  `dataviz` conventions (ARCHITECTURE §6a).
- **Typography for data:** one sans throughout; `tabular-nums` on every
  numeric; uppercase-tracked `text-xs` labels (the `SectionTitle`/`Stat`
  pattern) as the only "label voice". No serif, no display font — finance
  credibility is set in restraint.
- **Motion only on real events, under 300ms** (ARCHITECTURE §6a, verbatim).
  The existing `fadein` (new feed lines) and `breathe` (agent holding work)
  keyframes are the approved vocabulary; KPI "numbers that settle" joins
  them. No hover lifts, no page transitions, no spinners-for-show, and
  `prefers-reduced-motion` turns all of it off.

### 1.6 Borrow from Workday / refuse from Workday

**Borrow:**

- **Related actions** — every object offers its relevant actions *at the
  object* ([Workday's "⋯" pattern](https://uvafinance.virginia.edu/sites/uvafinance/files/2022-05/UVAFST_QRG_WorkdayNavigation.pdf)),
  never only from a distant admin screen.
- **Drillable reports** — §1.2; Workday's
  [drill-to-detail](https://doc.workday.com/workday-education/en-us/course-manuals/financial-management-for-administrators/workday-reporting.html)
  is the gold standard and our invariant.
- **Worklet-style dashboard** — the dashboard is a grid of small live
  aggregates ([role-based worklets](https://www.bnetbuilders.com/configure-workday-financial-role-based-dashboards-library-offerings/)),
  each one a door, composed from the same `Stat`/`Card` primitives as
  everywhere else.

**Refuse — the failure modes the ERP-UX literature documents
([UXPA](https://uxpamagazine.org/erp_software_revisited/?lang=en),
[enterprise-software critique](https://medium.com/leverage-technology-for-business/why-does-enterprise-software-suck-1f49ce0da990)):**

- **No modal mazes.** Modals only for destructive/irreversible confirmation.
  Creation and editing happen on pages or peeks with URLs. A modal that opens
  another modal is a bug by definition.
- **No 7-click journeys.** Budget: any object from anywhere in ≤2
  interactions (⌘K counts as one); any action on a visible object in ≤2
  clicks. [Ramp's redesign shipped 33% faster reviews through hierarchy
  alone](https://www.themasterly.com/blog/fintech-design-guide) — click
  count is a feature with a number on it.
- **No iframe feel.** No screen-within-screen chrome, no internal scrollbars
  inside page scroll, no stale frames; back button always correct; the whole
  app feels like one coherent surface, because it is one Next.js app.
- **No form-first screens.** Workday leads with the form; we lead with the
  record and its story. P2P's front door is a sentence to the Purchase
  Request Agent (`plans/P2P.md` §4), not a 14-field requisition form — the
  agent *is* the form replacement, and the demo narrates that.

### 1.7 The "pro, not weekend-demo" checklist

Fifteen details that separate production quality from a hackathon, checked
before any phase is called demo-ready:

1. Favicon + correct `<title>` per page ("PO-2026-0142 · AgenticFinance").
2. Visible focus rings on every interactive element (accent outline, never
   `outline: none` without replacement).
3. Skeletons that match final layout; **zero cumulative layout shift** on
   load ([skeletons done right](https://balevdev.medium.com/skeletons-the-pinnacle-of-loading-states-in-react-19-427cbb5a1f48)).
4. Relative timestamps ("4m ago") with absolute on hover via `title`, and a
   consistent absolute format (`2 Oct 2026, 14:32`) in tables.
5. Consistent empty states: one muted sentence + the action that fills it
   (never a blank region, never a sad-face illustration).
6. Unreachable ≠ empty, everywhere (§1.3) — keep extending the amber banner.
7. Tabular numerals and right alignment on every numeric column, no stragglers.
8. Every destructive or money-adjacent action confirms with the object named
   in the prompt ("Reject INV-0231 from Meridian Office Supply?").
9. Error states are written for a finance user, name the failing thing, and
   offer retry — no raw error objects, no toast-and-vanish.
10. Hover/active states on all rows and buttons; cursor semantics correct.
11. Text truncates with ellipsis + full value on hover; tables never wrap
    into misalignment.
12. Keyboard: `Esc` always closes the top-most peek/modal; focus returns to
    the invoking element.
13. Scroll position survives back-navigation in lists.
14. Dark mode verified per screen, not assumed from tokens.
15. No console errors or warnings in a demo build.

---

## PART 2 — Agent management UI

The thesis for Part 2: **agents are staff, and their management surface reuses
the ERP conventions above** — same record anatomy, same tables, same badges,
same drill-down. Novelty goes into *what* is shown (runs, releases, evals,
rationale), not into a second design language. The 2025–26 agent-UX discourse
converges on the same conclusion: trust comes from
[transparency, control, status and recoverability](https://fuselabcreative.com/ui-design-for-ai-agents/),
and the winning pattern is ["show the reasoning, allow the override, then
automate"](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/) — not
chat bubbles ([chat-first agent UX fails](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/)).

### 2.1 Mental model: a team page and staff records

- **The roster (`/agents`) is a team page**, not a config list: each card
  shows name, purpose, status, current release, and live state (breathing
  when holding work, per §6a). Think org directory, not admin table.
- **Each agent's page (`/agents/[slug]`) is a canonical record page with the
  §1.4 anatomy**: header = identity + active-release badge + status; thread =
  recent runs and release promotions; related objects = releases, skills,
  eval suites, permissions; plus the staff-specific strip: workload (open
  items), outcome rate, escalation rate, **cost per completed case** (the
  CLAUDE.md metric, not cost per request), each as a small sparkline. Numbers
  here obey §1.2: the cost figure drills to the runs that incurred it.
- Agents appear throughout the ERP as **attributed actors**: an agent chip
  (name + tiny status dot) in timelines, feed lines and approval cards,
  always linking to the agent page. Attribution is a load-bearing principle
  (MASTER_PLAN §3.6); the chip is its UI atom.

### 2.2 Seeing their work

- **Unified activity feed** (dashboard, `LiveFeed.tsx`): one calm line per
  event from the SSE stream, per §6a — the ambient "the office is working"
  layer. Every line links to its run or case.
- **Per-agent run history** on the agent page: a §1.3 table (when, work item,
  outcome badge, duration, tokens/cost), each row → the run page.
- **The live run transcript (`/runs/[id]`) is the hero view** — the "look
  inside its head" moment (§6a). It renders steps as they happen: thinking
  summary, tool call + result, proposed command, **gateway verdict**. The
  gateway verdict line is non-negotiable in the rendering: it shows that
  authority is enforced outside the model, which is the product's core claim.
  Run-history/audit views that show "what happened, when, on whose authority"
  are the one screen the agent-ops literature agrees every agent product
  needs ([enterprise agent UI patterns](https://www.entrans.ai/blog/best-user-interfaces-enterprise-ai-agent-development)).
- **Case-centric threads:** the case timeline (ARCHITECTURE §3 `evidence`)
  interleaves agent actions and human decisions in one thread on the business
  object — the Purchase thread already does this shape. Agent work is never
  ghettoised into an "AI tab"; it lives in the record's story.

### 2.3 Managing them

- **Skills editor with version diffing:** editing a skill creates a new
  immutable version (MASTER_PLAN §3.4); the UI shows a side-by-side or
  unified diff between versions, like a code review — because that is what
  it is. Markdown source view, not a WYSIWYG.
- **Release pipeline as a visible CI run:** `draft → evaluated → active →
  retired` rendered as horizontal stages with the eval suite result attached
  to the evaluated stage (pass/fail per case, drillable to the case detail).
  Promote is one accent button, enabled only when evals are green, recording
  who/when. The demo moment "edit skill → eval → promote → behaviour changes"
  (MASTER_PLAN Phase 1) is this screen.
- **Permissions matrix as the control room:** command types × agents, each
  cell showing none / propose / standing authority, with amount limits where
  relevant. Read-only view first (it visualises what the gateway enforces);
  editing a cell creates a draft release, never a live mutation. This single
  screen answers "what can your agents actually do?" — the first question
  every sceptical finance audience asks.
- **Model/budget settings with cost shown:** model profile (extraction /
  default / reasoning per CLAUDE.md routing) and per-run budget on the
  release, alongside observed cost per completed case — so a model change is
  made next to its evidence. Changing model = new release, eval before
  promote (CLAUDE.md rule), and the UI enforces that path by construction.

### 2.4 Approvals: THE first-class surface

One inbox (`/approvals`) for everything that needs a human: purchase
approvals (standard/director bands), exception resolutions, retro purchases,
escalations (`plans/P2P.md` §6). Modelled on the
[agent-inbox pattern](https://aiagentsdirectory.com/agent/agent-inbox-ui) that
LangGraph's ecosystem standardised —
[HITL as a first-class interrupt with an explicit decision payload](https://docs.langchain.com/oss/python/langchain/frontend/human-in-the-loop)
— which is exactly what our command gateway already is on the backend.

- **Rich context cards, decidable in place:** each item shows *what* (typed
  command + parameters, money in §1.3 format), *why now* (the triggering
  event), *evidence* (linked documents, match diff), and **the agent's
  rationale verbatim** — quoted, attributed to agent + release, visually
  distinct from system fact. Model text is never evidence of approval
  (MASTER_PLAN §3.3); the card typography must make the fact/claim boundary
  visible: facts in foreground, the agent's words in a quoted block.
- **One-click decide, two-step commit:** Approve/Reject on the card;
  the confirm step names the object and amount (§1.7.8). Reject requires a
  one-line reason — it feeds the eval corpus and the decision history.
- **Decision history** is a permanent, filterable log (who, what, when,
  rationale → `evidence.human_decision`), drillable from both the agent page
  and the business object. Approvals are never toasts that vanish; they are
  records.
- **No playfulness here.** The inbox is the most conservative screen in the
  product: no motion except fade-in of new items, no breathing, standard
  table/card idiom. See §2.6.

### 2.5 Trust UI

Trust is a surface area, not a disclaimer
([audit trails and oversight as design requirements](https://www.setproduct.com/blog/ai-agent-ui-design-patterns)):

- **Evidence links everywhere:** any agent claim in a card or timeline links
  the document/record it is based on. A claim without a link reads as a
  claim; demo narration depends on clicking through.
- **Eval scores on releases:** the active release's eval result (n passed /
  total, last run date) shows on the agent header — the agent's visible
  qualification, like a certification on a staff profile.
- **"Why did it do that":** every outcome traces to its run transcript in
  one click from wherever it is seen (feed line, timeline entry, posted
  journal → command → run). The transcript is the answer; we never summarise
  it into a vaguer "AI explanation".
- **Visible guardrails:** hard blocks render as hard blocks. The
  `bank_detail_change` case shows a locked state: "outside this agent's
  command set — human verification required, always" (`plans/P2P.md` §5).
  Showing what agents *cannot* do is the strongest trust move in the demo
  script (§8.4), so the UI states it explicitly rather than silently routing.
- **Standing authority is logged, visibly:** auto-band approvals show the
  rule that fired ("auto: ≤£500, known supplier, within budget") on the
  timeline. Automation without a visible rule reads as magic; with the rule,
  it reads as policy.

### 2.6 Playfulness policy — demo-engaging, tasteful

The §6a live layer is the product's charisma. Where it is allowed and where
it is forbidden is a policy, not taste-by-screen:

| Allowed (live activity) | Forbidden (money & judgement) |
|---|---|
| Breathing agent cards while holding work | Approvals inbox and decision confirmations |
| Moving document chips in the process flow view (P2P M5) | Journal, trial balance, statements |
| Feed line fade-in; KPI numbers settling | Payment run screen |
| Live transcript steps appearing | Permissions matrix |
| Demo pacing toggle (delays presentation of real events, never fabricates — §6a) | Anything rendering an amount a human is about to act on |

The rule generalising the table: **motion may say "something real is
happening"; it may never decorate a decision.** A screen where a human
commits money or judges an agent's proposal is still — always.

### 2.7 Where we deliberately break ERP convention

1. **Conversation as intake, not forms.** The Purchase Request Agent replaces
   the requisition form (`plans/P2P.md` §0). Justified: the structured record
   still exists and is the canonical page; the conversation is just a better
   keyboard for creating it.
2. **Approve once, at intent.** No invoice re-approval for clean matches —
   contra every ERP's double-gate. Justified by D12: control moved to where
   the decision happens, and the UI narrates the absence ("zero human touches
   since approval") instead of hiding it.
3. **Live motion in a system of record.** ERPs are static; our feed,
   breathing cards and flow view move. Justified: every animation is a real
   event from `activity_event` (D9) — it is telemetry made visible, bounded
   by §2.6, never fabricated.
4. **Agents on the team page.** No ERP shows its automation as colleagues
   with records, workloads and qualifications. Justified: attribution and
   accountability are architectural invariants; personifying the roster makes
   the accountability model legible rather than cute.
5. **Transcripts as first-class UI.** ERPs bury logs in admin consoles; we
   make the run transcript a hero page. Justified: "explainable from the
   workbench" is a success criterion (MASTER_PLAN §8), and
   [reasoning-visibility is where agent products win or lose trust](https://fuselabcreative.com/ui-design-for-ai-agents/).

### 2.8 Component strategy

Current `ui.tsx` primitives (Card, Stat, Badge, SectionTitle) stay the
foundation. **Adopt [shadcn/ui](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4)
selectively** — it is Tailwind-v4 native, copies source into the repo (no
dependency lock-in), and is the de-facto standard for this stack. Take only:
`Command` (⌘K, §1.1), `Dialog` (confirmations), `Sheet` (peek panels),
`Tooltip`, `DropdownMenu` (related actions), and `Tabs`. Do **not** take its
table stack (TanStack is overkill at demo volume — our server-rendered tables
are fine) or restyle existing primitives to match shadcn defaults; shadcn
components get re-themed to our tokens, not the reverse.

---

## PART 3 — Gap analysis: current workbench vs this doctrine

Prioritized punch list; each item names its natural milestone.

1. **Stage tiles and KPI counts don't drill** — P2P stage cards and `Stat`
   tiles are dead-end numbers, violating §1.2. Make every count a link to the
   filtered list. *(P2P M3, small)*
2. **No canonical pages for invoices, suppliers, journals, cases** — only
   purchases, runs and agents have them. Invoices in the exceptions list are
   unclickable. *(P2P M3)*
3. **Approvals inbox lacks context cards** — decisions need what/why/
   evidence/rationale per §2.4 before the P2P exception demo lands. *(P2P M3)*
4. **No command palette** — highest-leverage pro signal (§1.1); first shadcn
   adoption step. *(P2P M5 / polish)*
5. **Money formatting duplicated and incomplete** — `gbp()` is copy-pasted in
   at least two pages, with no negative-parentheses handling. Create
   `src/lib/format.ts` (money, dates, relative time) and use it everywhere.
   *(now, trivial)*
6. **No breadcrumbs on object pages** — Purchase and run pages orphan the
   user. *(P2P M3, small)*
7. **No loading skeletons** — server components render late instead of
   streaming skeletons; violates §1.7.3. Add `loading.tsx` per route group.
   *(P2P M5)*
8. **Unreachable-vs-empty banner not systematic** — implemented on P2P page
   only; extract the banner + the `apiDown` pattern into a shared component
   and apply on every data page. *(P2P M3, small)*
9. **Timestamps raw** — dates render as ISO slices; no relative times, no
   hover absolutes (§1.7.4). Part of `format.ts`. *(now, small)*
10. **Badge semantic colours hardcoded** — `#d97706`/`#dc2626` in `ui.tsx`
    and the P2P banner bypass the token system and don't adapt to dark mode.
    Add `--warn`/`--bad` tokens. *(now, trivial)*
11. **No favicon, generic per-page titles** — layout metadata is static
    (§1.7.1). *(P2P M5)*
12. **Agent page missing staff-record strip** — no workload, escalation rate,
    cost-per-completed-case or eval score on the header (§2.1, §2.5). Data
    exists in `agent_run`/`eval_run`. *(P2P M5 / Phase 6)*
13. **Permissions matrix absent** — permissions are per-release JSON with no
    control-room view (§2.3). *(Phase 6)*
14. **Release pipeline not visualised** — releases render as a list, not the
    draft→eval→promote pipeline with attached eval results (§2.3). *(Phase 6)*
15. **Decision history view absent** — `human_decision` rows have no surface
    (§2.4). *(Phase 6)*

Items 1–9 are the P2P-phase quality floor; 10–11 are sub-hour fixes to do
opportunistically; 12–15 ride with the agent-management deepening in Phase 6.

---

### Source index

Workday patterns: [reporting & drill-down](https://doc.workday.com/workday-education/en-us/course-manuals/advanced-workday-reporting-for-financials/workday-reporting-for-finance.html) ·
[navigation & related actions QRG](https://uvafinance.virginia.edu/sites/uvafinance/files/2022-05/UVAFST_QRG_WorkdayNavigation.pdf) ·
[worklet dashboards](https://www.bnetbuilders.com/configure-workday-financial-role-based-dashboards-library-offerings/).
ERP UX critique: [UXPA Magazine](https://uxpamagazine.org/erp_software_revisited/?lang=en) ·
[enterprise software critique](https://medium.com/leverage-technology-for-business/why-does-enterprise-software-suck-1f49ce0da990) ·
[ERP/B2B UI struggles](https://medium.com/@bayu.alpiansyah/why-erp-and-b2b-saas-products-continue-to-struggle-with-poor-ui-design-d627d4341606).
Modern finance tools: [fintech UX teardowns (Ramp, Mercury)](https://www.themasterly.com/blog/fintech-design-guide) ·
[Ramp reviews](https://www.g2.com/products/ramp-financial-ramp/reviews) ·
[Pigment drill-down](https://www.pigment.com/newsroom/virgin-voyages-selects-pigment-to-modernize-financial-planning) ·
[Puzzle](https://puzzle.io/).
Craft bar: [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh) ·
[Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) ·
[Karri Saarinen's 10 rules](https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/).
Tables: [Pencil & Paper enterprise tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) ·
[Setproduct table guide](https://www.setproduct.com/blog/data-table-ui-design) ·
[UI Prep table guide](https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables).
Agent UX: [LangGraph HITL](https://docs.langchain.com/oss/python/langchain/frontend/human-in-the-loop) ·
[Agent Inbox](https://aiagentsdirectory.com/agent/agent-inbox-ui) ·
[agent UI patterns for plans/approvals/undo](https://www.setproduct.com/blog/ai-agent-ui-design-patterns) ·
[agent UX patterns (anti chat-first)](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/) ·
[agent trust/transparency principles](https://fuselabcreative.com/ui-design-for-ai-agents/) ·
[enterprise agent UI patterns](https://www.entrans.ai/blog/best-user-interfaces-enterprise-ai-agent-development).
Stack: [shadcn/ui on Tailwind v4](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4) ·
[cmdk Command component](https://shadcnstudio.com/docs/components/command) ·
[skeleton loading practice](https://balevdev.medium.com/skeletons-the-pinnacle-of-loading-states-in-react-19-427cbb5a1f48).

---

## PART 4 — Numbers, money and analytics (v2, Alec feedback 2026-10-03)

Part 1 governed structure; this part governs the *visual identity of data*,
because "one sans, no display font" at browser defaults is exactly what reads
as a template. The references we build toward: Stripe's dashboard (money
typography), Mercury (finance gravitas through restraint), Linear (type
scale and calm chrome), Attio (data-dense tables), Tremor (analytics
components for this stack, Phase 4c).

### 4.1 Typefaces — the single biggest lever

- **UI sans: Inter** (variable, self-hosted via `next/font`), `--font-sans`.
  Headings `tracking-tight`; body `text-sm`. No other sans, ever.
- **Data mono: IBM Plex Mono**, `--font-mono`. Worn by: every numeric **table
  column**, money amounts in rows and running text, identifiers (PO/invoice
  numbers), dates in tables, and code-ish values. Mechanism: all table cells
  marked `tabular-nums` render in mono automatically (globals.css); inline
  data uses the `num` utility class.
- **Big figures are proportional sans, not mono.** A KPI value or hero number
  uses Inter semibold with default (proportional) figures — `tabular-nums`
  makes display-size numbers look loose. Tabular/mono is for *columns that
  must align*, full stop.

### 4.2 Type scale (the only sizes)

| Voice | Spec |
|---|---|
| Page title | `text-2xl font-semibold tracking-tight` |
| Section/card heading | `SectionTitle` (text-sm semibold uppercase tracked, muted) |
| KPI value | `text-2xl font-semibold` (proportional figures) |
| Body / table | `text-sm` |
| Meta / hints / labels | `text-xs`, muted |

Nothing else. A new size is a design decision, not a page decision.

### 4.3 Money and number rules

- **Precision ladder:** records and table cells show full pence (`£8,899.20`);
  aggregates and KPI values auto-compact — `£1,284` → `£12.9k` → `£4.2m`
  (one decimal at k/m) via `moneyCompact()`; counts compact the same way
  (`1,284` / `12.9k`). Never mix precisions within one column.
- **Negatives:** accounting parentheses `(£1,234.00)` in financial columns
  (already in `money()`); deltas use signed `+/−` with the arrow optional.
- **Variance semantics — colour by meaning, never by sign.** Cost up = bad
  (red), revenue up = good (green), neutral movements stay ink. A delta
  renders through one helper that takes `goodWhen: "up" | "down"`.
- **Zero vs blank vs down** (restating §1.3): zero is `£0.00`, blank means
  unknown, API-down is the amber banner — never conflate.
- **Alignment matrix:** text left · money/numbers right in mono · dates right
  of text, left of numbers · status badge fixed-width · identifier column is
  the link, medium weight.

### 4.4 KPI tile grammar (one component, no ad-hoc tiles)

`Kpi` is the only stat tile: **label** (sentence case, muted, no colon) ·
**value** (Inter semibold, auto-compact, proportional figures) · optional
**delta** (signed, vs a named period, coloured by meaning per §4.3) ·
optional **hint** (one muted line). A Kpi that aggregates something is a
link to the list that produced it (§1.2). Hand-rolled `div` tiles are a
defect; pages compose `Kpi` or nothing.

### 4.5 Buttons (one component)

`Button` with variants `primary` (accent fill, white text — at most one per
view region), `outline` (border accent, accent text — secondary actions),
`ghost` (border token — tertiary), `danger` (border/bad — destructive, always
behind a named confirm, §1.7.8). Fixed paddings; `whitespace-nowrap`;
disabled at 40%. Hand-rolled button styling is a defect.

### 4.5b Action vocabulary (Alec, 2026-10-03)

Buttons carry a VERB + OBJECT and map to exactly one variant by what the
action does — never restyled per page:

| Action kind | Variant | Label pattern | Rules |
|---|---|---|---|
| Run / process (demo & system runs) | `primary` for the scenario's lead action, `outline` for alternatives | "Process May 2026", "Run evals" | The one thing the user most likely came to press is filled; there is at most one filled button per region |
| Commit money / judgement (approve, apply, resolve) | `primary` | "Approve", "Apply — part approve" | Two-step confirm naming the object and amount (§1.7.8); reject requires a reason |
| Destructive (wipe, reject, delete) | `danger` | "Clear to zero", "Reject INV-0231" | Always behind a named confirm |
| Edit / configure | `ghost` | "Edit", "Draft release" | Edits create versions where the object is versioned |
| Ask an agent | `outline`, agent named | "Ask the agent for options", "Re-investigate" | Model-spending actions say so in the tooltip |
| Navigate | never a button | link + "→" (in-app), "↗" (new tab/external) | Links navigate; buttons act |

**A disabled button always says why, next to it** — a greyed button with no
explanation is a defect (the "all months loaded" case: the hint names the
blocker and links the unblocking action). While a run is in progress,
actions disable with a one-line "re-enables when it finishes".

### 4.6 Motion correction

§1.5 already forbids hover lifts; the `hover:-translate-y` instances that
crept in are removed and must not return. Hover = background tint or border
emphasis only. The approved motion vocabulary stays: `fadein`, `breathe`,
numbers settling — real events only.

### 4.7 Charts & analytics (Phase 4c rails, decided now)

Charts follow the dataviz method (form first, colour by job, validate the
palette, thin marks, hover layer, legend rules). Our parameter block:
sequential = the accent teal ramp; diverging = teal↔amber with neutral grey
midpoint; status palette = the badge tones (never reused as series colours);
categorical order fixed when the first multi-series chart lands (validated,
not eyeballed); surfaces = `--card` light/dark. Sparklines in Kpi `trend`
slots use the muted ink with the current period in accent. One axis, always;
every chart drills (§1.2); a table view exists for every chart.
