# syntax=docker/dockerfile:1.7
# Multi-stage build producing two targets from one codebase:
#   web    — Next.js standalone server (port 3000)
#   worker — sync/analysis worker + CLI (also used for schema push and demo seed)

FROM node:22-bookworm-slim AS base
# No phone-home from build tools either: Next.js CLI telemetry and Prisma update checks off.
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/connectors/package.json packages/connectors/
COPY packages/analysis/package.json packages/analysis/
COPY packages/db/package.json packages/db/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/policy/package.json packages/policy/
COPY packages/content-scan/package.json packages/content-scan/
RUN npm ci

FROM deps AS build
COPY . .
# `prisma generate` needs a URL shape, not a live database.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run db:generate && npm run build -w @aiv/web

# ---------- worker ----------
# Reads file content IN MEMORY for classification; nothing is written to disk.
FROM build AS worker
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false
RUN chown -R node:node /app/packages/db/prisma
USER node
CMD ["npm", "run", "start", "-w", "@aiv/worker"]

# ---------- web ----------
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 app
COPY --from=build --chown=app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
