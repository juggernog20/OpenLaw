# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-only
#
# The OpenLaw application image (TECH-017): one image carrying the API
# (which serves the built SPA same-origin) and the worker entrypoint
# (TECH-007 — same image, different command). Build from the repo root:
#
#   docker build -t openlaw .
#
# The default command runs the API; the worker service runs the same
# image with: node apps/worker/dist/index.js

FROM node:24-slim AS base
RUN npm install --global pnpm@10.30.3
WORKDIR /app

# --- Build: full workspace install, turbo build of every app ---
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api-client/package.json packages/api-client/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# --- Production dependencies only, for the runtime layer ---
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api-client/package.json packages/api-client/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --filter @openlaw/api... --filter @openlaw/worker...

# --- Runtime ---
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
# Workspace manifests + production node_modules (pnpm's relative symlinks
# survive the copy because the whole /app tree comes over together).
COPY --from=prod-deps /app ./
# Built output. The API resolves the web bundle at ../../web/dist
# relative to its own dist, so the workspace layout is preserved.
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/web/dist apps/web/dist

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
