# AgenticFinance 3.0

A modern, agentic finance function — a workspace for running AI agents that handle
real finance workflows (close, reporting, AP/AR, forecasting, analysis) for a small
business, and a sandbox for exploring agentic coding patterns in finance.

## How this repo is organised

```
agents/           One directory per agent. Each agent is an independently
                  deployable Railway service with its own Dockerfile and
                  railway.json.
  example-agent/  A minimal working agent to copy as a template.
shared/           Code shared across agents (clients, schemas, utilities).
docs/             Architecture and design docs. The architecture doc lives here.
scripts/          Operational scripts (deploy, local dev helpers).
```

## Principles

- **One agent, one service.** Each agent deploys as its own Railway service so
  it can be scaled, scheduled, and rolled back independently.
- **Agents are boring web services.** Every agent exposes a small HTTP surface
  (`/health`, `/run`) so Railway, cron triggers, and other agents can invoke it.
- **The intelligence lives in the agent loop**, built on the Anthropic API —
  tools, structured outputs, and human-in-the-loop checkpoints where money moves.
- **Humans approve irreversible actions.** Agents draft, reconcile, and propose;
  payments and filings require explicit approval.

## Deploying to Railway

Deployment is done with the [Railway CLI](https://docs.railway.com/guides/cli):

```bash
railway login                  # once
cd agents/example-agent
railway link                   # link this directory to its Railway service
railway up                     # build & deploy
```

Or use the helper: `scripts/deploy.sh <agent-name>`.

Each agent reads its configuration from environment variables (set via
`railway variables` or the Railway dashboard). See `.env.example` for the
common set.

## Local development

```bash
cd agents/example-agent
pip install -e .
cp ../../.env.example .env     # fill in values
uvicorn example_agent.main:app --reload
```

## Status

Scaffold stage. The architecture doc (to be added under `docs/`) will drive the
real agent roster and the shared infrastructure.
