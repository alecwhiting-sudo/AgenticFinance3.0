# CLAUDE.md — project conventions

> **NOTE (2026-10-01):** The design has moved on from the layout below. The
> agreed target is a TypeScript monorepo (web / api / worker) per
> `docs/ARCHITECTURE.md` and `docs/MASTER_PLAN.md` — read those first. The
> Python per-agent layout described here is the placeholder scaffold and is
> replaced in Phase 0, when this file gets rewritten.

## What this repo is

An agentic finance function: AI agents that perform finance workflows for a small
business. Agents are Python services deployed to Railway (one Railway service per
agent), invoked over HTTP or on a schedule.

## Layout

- `agents/<name>/` — one deployable agent per directory. Each has:
  - `pyproject.toml` (package name matches the directory, underscored)
  - `src/<package>/main.py` — FastAPI app exposing `/health` and `/run`
  - `src/<package>/agent.py` — the agent loop (Anthropic API)
  - `Dockerfile` + `railway.json` — Railway deployment
  - `README.md` — what the agent does, its inputs/outputs, required env vars
- `shared/` — cross-agent code. Keep it dependency-light; agents vendor it via
  path dependency or copy until it stabilises.
- `docs/` — architecture and design docs. **Read `docs/` before structural
  changes**; the architecture doc there is the source of truth once added.
- `scripts/deploy.sh <agent>` — wraps `railway up` for a given agent.

## Conventions

- Python ≥ 3.11, FastAPI, `anthropic` SDK. Format with the repo defaults
  (ruff, if configured).
- New agent = copy `agents/example-agent`, rename package, update README and
  `railway.json`.
- Secrets and config come from environment variables only — never commit keys.
  Document every required variable in the agent's README and `.env.example`.
- Default model comes from the `ANTHROPIC_MODEL` env var; don't hardcode model
  IDs in agent logic.
- Finance safety rule: any action that moves money, files with an authority, or
  sends external communications must go through an explicit human-approval
  checkpoint. Agents propose; humans approve.

## Deployment

Railway CLI only (`railway login`, `railway link`, `railway up`), from inside
the agent's directory. `railway.json` controls build/start. Don't introduce
other deploy mechanisms without updating the architecture doc.
