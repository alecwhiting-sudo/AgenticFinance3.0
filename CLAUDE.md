# CLAUDE.md — project conventions

## What this repo is

An agentic finance function for a small business: a mini ERP/EPM on PostgreSQL,
an agent framework (registry, versioned skills/releases, work queue, command
gateway, evals), and a workbench front end — demo-first, production later.
**Start here:** `docs/STATUS.md` — the one-page progress tracker; update it in
the same commit as any milestone, deferral or decision.
**Source of truth:** `docs/MASTER_PLAN.md` (phases, scope) and
`docs/ARCHITECTURE.md` (design, decisions D1–D14). Read both before structural
changes, and update `docs/architecture.html` (the living diagram) in the same
commit as any structural change. Per-process plans live in `docs/plans/`.

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
  `ANTHROPIC_MODEL*` env vars; never hardcode model IDs in agent logic.

## Model routing & cost

Route models by **task shape**, never by agent prestige. Each agent release
declares a `modelProfile`; the worker resolves `ANTHROPIC_MODEL_<PROFILE>` →
`ANTHROPIC_MODEL` → the tier default (`apps/worker/src/runtime/agentLoop.ts`):

| Profile | Default tier | Use for |
|---|---|---|
| `extraction` | Haiku 4.5 | high-volume, schema-tight work: document extraction, classification, cash matching |
| `default` | Sonnet 5.5 | the agent workhorse: intake, investigation, drafting, commentary |
| `reasoning` | Opus 5.5 | only where judgement demonstrably needs it — promote a profile here on eval evidence, not vibes |
| `none` | no model | deterministic handlers only |

Rules: changing an agent's model is a release change (eval before promote);
downgrades need the eval suite green on the cheaper model; judge cost per
*completed case*, not per request (a cheap model that escalates everything is
expensive). Deterministic services are always the cheapest model — if code can
decide it, no model call at all.

For **Claude Code dev sessions on this repo** (human guidance, not enforced):
Sonnet 5.5 for routine implementation and fixes; Opus 5.5 (default) for
feature building; reserve Fable-class sessions for architecture/planning
decisions; `/code-review` at medium effort for routine diffs, high for
schema/gateway/posting changes.
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
