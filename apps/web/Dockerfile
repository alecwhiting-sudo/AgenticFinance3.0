# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
# Railway passes service variables to Docker builds only as declared build args.
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so it must be
# visible HERE, not just at runtime.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @af/web...
RUN pnpm --filter @af/shared build && pnpm --filter @af/web build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
