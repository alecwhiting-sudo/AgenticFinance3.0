# AgenticFinance 3.0

An agentic finance function for a small business — AI agents running finance
processes (P2P, R2R, O2C, performance management) on a mini ERP/EPM, with a
workbench to manage, monitor, test and evolve the agents. Demo-first; a
production version follows once the business is ready.

**Plans and design:** `docs/MASTER_PLAN.md` · `docs/ARCHITECTURE.md` ·
`docs/plans/` · research basis in `docs/research/`.

## Status

**Phase 0 complete** — monorepo skeleton, Postgres schema + migrations,
Brightline Services plc seed data, three deployable services, Railway configs.
Next: Phase 1 (agent framework + workbench core + live activity stream +
Demo Data Studio).

## Structure

| Path | What |
|---|---|
| `apps/web` | Next.js workbench (port 3000) |
| `apps/api` | Fastify platform API — finance services, command gateway (3001) |
| `apps/worker` | Agent runtime — queue claiming, agent loops (3002) |
| `packages/shared` | Zod schemas/types shared across apps |
| `packages/db` | Drizzle schema, migrations, seeds (`seed/brightline.json`) |
| `docs` | Master plan, architecture, per-process plans, research |

## Quick start (local)

```bash
pnpm install
createdb agenticfinance            # or any Postgres you have
export DATABASE_URL=postgresql://user:pass@localhost:5432/agenticfinance
pnpm db:migrate && pnpm db:seed    # pnpm seed:reset → pristine demo state
pnpm dev:api & pnpm dev:worker & API_URL=http://localhost:3001 pnpm dev:web
```

Open http://localhost:3000 — the dashboard shows Brightline Services plc, master-data
counts, the current period, and service health.

## Deploying to Railway

One Railway project, four services: `web`, `api`, `worker`, and the Postgres
plugin. Each app service builds from the **repo root** using its own
Dockerfile (`apps/<name>/Dockerfile`; settings in `apps/<name>/railway.json`).

One-time setup:

```bash
railway login
railway init                       # create the project
railway add --database postgres    # Postgres plugin
# create the three services (repeat per service):
railway add --service api          # then set in the dashboard or via CLI:
#   - config file path: apps/api/railway.json
#   - env: DATABASE_URL=${{Postgres.DATABASE_URL}}
#   - web also needs API_URL=<api service internal/public URL>
```

Deploys:

```bash
scripts/deploy.sh api      # railway up with the right service linked
scripts/deploy.sh worker
scripts/deploy.sh web
railway run pnpm db:migrate && railway run pnpm db:seed   # once per DB
```
