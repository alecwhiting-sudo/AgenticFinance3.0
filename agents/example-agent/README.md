# example-agent

Template agent. Copy this directory to start a new agent.

A minimal FastAPI service wrapping an Anthropic agent loop with one example tool
(a calculator). It exists to prove out the deploy pipeline and to be the
starting point for real agents.

## Endpoints

- `GET /health` — Railway healthcheck.
- `POST /run` — `{"task": "..."}` → `{"result": "..."}`. Runs the agent loop on
  the task and returns the final answer.

## Environment variables

| Variable            | Required | Description                                   |
| ------------------- | -------- | --------------------------------------------- |
| `ANTHROPIC_API_KEY` | yes      | Anthropic API key                              |
| `ANTHROPIC_MODEL`   | no       | Model ID (default `claude-sonnet-5-5`)         |
| `PORT`              | no       | Injected by Railway; defaults to 8000 locally  |

## Run locally

```bash
pip install -e .
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn example_agent.main:app --reload
curl -X POST localhost:8000/run -H 'content-type: application/json' \
  -d '{"task": "What is 1200 * 1.2 - 340?"}'
```

## Deploy

```bash
railway link   # once, from this directory
railway up
```

or `../../scripts/deploy.sh example-agent` from anywhere in the repo.
