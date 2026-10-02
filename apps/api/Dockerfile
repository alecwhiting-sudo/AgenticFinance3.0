# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @af/api...
RUN pnpm --filter @af/shared build && pnpm --filter @af/db build && pnpm --filter @af/api build

ENV NODE_ENV=production
ENV PORT=3001
# Load the demo dataset on boot (idempotent: self-skips once loaded; deterministic, no LLM).
CMD ["sh", "-c", "node apps/api/dist/scripts/loadDataset.js || echo 'loader skipped/failed (non-fatal)'; node apps/api/dist/server.js"]
