# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 1) deps — install exact dependency versions once, cached across builds
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---------------------------------------------------------------------------
# 2) builder — generate the Prisma client and produce the Next.js build
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL isn't needed at build time (`next build` doesn't touch the
# DB), but Prisma's schema loader wants the env var defined — any value works.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# 3) runner — the actual image that ships. Full node_modules (incl. the
# Prisma CLI, needed at container start for `prisma migrate deploy`) rather
# than Next's standalone tracing — simpler and more predictable for an
# internal tool than chasing down which native Prisma engine files tracing
# does or doesn't pick up.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

ENV NODE_ENV=production
ENV HOME=/home/nextjs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# src/ + tsconfig are only needed so `docker compose exec app npx tsx
# prisma/seed.ts` (seeding demo accounts) works against a running
# container — the app itself runs from the compiled .next output above.
COPY --from=builder /app/src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /home/nextjs && chown -R nextjs:nodejs /home/nextjs /app \
    && chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
