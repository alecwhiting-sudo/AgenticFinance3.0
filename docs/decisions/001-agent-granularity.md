# ADR-001 — Agent granularity: several agents per process, split by authority

**Status:** Accepted (Alec, 2026-10-02) · **Applies to:** every process
(P2P first) · **Recorded in:** ARCHITECTURE.md decision log as D11

## Question

For a process like P2P, is it better to run **one agent** covering the whole
cycle, or **several agents** working across it?

## The case for one agent per process

- **Context is the whole game.** An invoice dispute spans the cycle — the
  price variance exists because of an email weeks ago, tied to an amended
  purchase, affecting the payment run. One agent that saw everything holds
  the full thread; split agents must reconstruct context at every handoff,
  and anything unwritten is lost at the boundary.
- **Fewer moving parts.** One identity, one release, one eval suite, one
  permission set. Every boundary adds handoff conventions and registry
  ceremony — heavy for a 15-person business's volumes.
- **Models reward scope.** Model capability grows faster than orchestration
  cleverness. A single capable model with good tools allocates attention
  dynamically; pre-carved boundaries bet that we know today where the task
  structure lies. Betting against the model has repeatedly lost.
- **Simpler accountability.** One audit trail and owner, not a whodunit
  across agents and handoff logs.

## The case for several agents

- **The stages are genuinely different work.** Extraction is high-volume /
  low-judgement (cheap model, tight schemas); exception investigation is
  low-volume / high-judgement (strong model, room to reason). One agent means
  one model profile and one budget serving both — paying investigation prices
  for extraction, or starving investigation. The scaling evidence (Kim et al.,
  via the research doc) says more agents help exactly when the task
  decomposes — and P2P decomposes: sequential stages with clean typed
  interfaces (a captured invoice, a match result, a case).
- **Permissions are decisive in finance.** The agent that reads untrusted
  supplier documents (the prompt-injection surface — our dataset contains two
  bank-detail-change fraud emails) must be a different principal from one
  that can propose money movement. Collapsing them is the classic
  confused-deputy setup; segregation of duties is centuries old because "one
  capable generalist who does everything" is the fraud-risk profile.
- **Blast radius and iteration speed.** Re-release a small extraction agent
  against a focused eval suite without re-risking exception handling. A
  mega-agent's every prompt tweak re-risks the whole cycle.
- **Prompt decay.** One prompt covering capture + matching + investigation +
  payments becomes the "one enormous shared prompt" the research doc warns
  about.
- **The context argument has a better answer than merging:** continuity lives
  in the **case record** (evidence, timeline, decisions), assembled into
  whichever agent touches it next. Shared state in the database beats shared
  state in one agent's conversation — it survives restarts, is auditable, and
  humans see the same thread.

## Where each side is right

Single-agent is right that the *unit of accountability* should feel like one,
and that over-decomposition (an agent per step) is workflow fragments wearing
agent badges. Multi-agent is right about permissions, cost routing and blast
radius — and in finance those are the controls that make automation
defensible.

## Decision

**Several agents per process, decomposed by authority and capability profile
— never by process step — and kept few.**

The test for any proposed agent: it must justify itself by a **distinct
permission set**, a **distinct cost/capability profile**, or a **distinct
accountability owner**. Differing only by "different step" makes it a
workflow stage, not an agent. The test cuts both ways: it retired the Payment
Run Agent when the unified Purchase model removed the judgement from that
step (plans/P2P.md §4).

Two standing commitments make this cheap:

1. **Continuity lives in the case, not the agent** — handoffs pass a case ID,
   never a summary-and-pray.
2. **The cycle is owned by the deterministic workflow**, not by any agent —
   no "orchestrator agent" to become the mega-agent through the back door.

## Reversibility

Agents here are configuration (identity + release + permissions) over one
shared runtime: merging two agents later is an afternoon. Splitting a
mega-agent whose prompt, permissions and eval history have fused is the
expensive direction. We start on the reversible side.
