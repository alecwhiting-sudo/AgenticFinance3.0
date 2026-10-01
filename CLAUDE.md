# CLAUDE.md — project conventions

## What this repo is

An agentic finance function for a small business: a mini ERP/EPM on PostgreSQL,
an agent framework (registry, versioned skills/releases, work queue, command
gateway, evals), and a workbench front end — demo-first, production later.
**Source of truth:** `docs/MASTER_PLAN.md` (phases, scope) and
`docs/ARCHITECTURE.md` (design, decisions D1–D10). Read both before structural
changes. Per-process plans live in `docs/plans/`.

## Layout

pnpm workspace monorepo, TypeScript throughout (Node 22, ESM):

- `apps/web` — Next.js workbench (Tailwind v4; design: minimal, one accent
  colour, CSS variables in `globals.css` for light/dark).
- `apps/api` — Fastify platform API. Owns all business logic: finance
  services, command gateway, registries. **The only writer to ERP tables.**
- `apps/worker` — agent runtime. Claims work items, runs agent loops
  (Anthropic SDK), proposes typed commands to the API — never writes ERP
  tables directly.
- `packages/shared` — Zod schemas and types shared by all apps.
- `packages/db` — Drizzle schema (`src/schema.ts`, Postgres schemas `core`,
  `erp`, later `epm`/`agent`/`evidence`), migrations, seeds. Seed data in
  `seed/` is committed JSON/documents; seeding never calls an LLM.
- `scripts/deploy.sh <web|api|worker>` — Railway deploy wrapper.

## Conventions

- Strict TypeScript; `pnpm -r typecheck && pnpm -r build` must pass before
  commit/push.
- Money: integer minor units (pence) or `numeric`; never floats.
- Journal rules (from Phase 2): append-only once posted; reversals, not edits;
  every journal has a `source_type`/`source_id`.
- Schema changes: edit `packages/db/src/schema.ts` → `pnpm db:generate` →
  commit the generated migration → `pnpm db:migrate`. Never edit applied
  migrations. Keep all table definitions in that single file (drizzle-kit
  can't follow cross-file ESM imports).
- New API surface: define the Zod schema in `packages/shared` first; web and
  worker consume the inferred types.
- Secrets/config via env vars only (`.env.example` documents them). Model from
  `ANTHROPIC_MODEL*` env vars; never hardcode model IDs.
- Finance safety rule: anything that moves money, posts material journals, or
  sends external communications requires an explicit human-approval checkpoint
  through the command gateway. Agents propose; humans approve.
- Agent behaviour changes (instructions, skills, tools, model) always create a
  new release; nothing mutates an active release.

## Local development

```bash
pnpm install
export DATABASE_URL=postgresql://af:af@localhost:5432/agenticfinance
pnpm db:migrate && pnpm db:seed   # seed:reset for a pristine state
pnpm dev:api      # :3001
pnpm dev:worker   # :3002
pnpm dev:web      # :3000 (set API_URL=http://localhost:3001)
```

## Deployment

Railway CLI only: three services (web, api, worker) + Postgres plugin in one
Railway project. Each service builds from the **repo root** with its
`apps/<name>/Dockerfile` (config in `apps/<name>/railway.json`); deploy with
`scripts/deploy.sh <name>` or `railway up` from the repo root with the service
linked. Run migrations via `railway run pnpm db:migrate`. Don't introduce
other deploy mechanisms without updating the architecture doc.
