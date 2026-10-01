# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @af/worker...
RUN pnpm --filter @af/shared build && pnpm --filter @af/db build && pnpm --filter @af/worker build

ENV NODE_ENV=production
ENV PORT=3002
CMD ["node", "apps/worker/dist/main.js"]
