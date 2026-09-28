#!/bin/sh
# Runs once on every container start, before the app comes up.
set -e

echo "[entrypoint] Applying database migrations..."
npx prisma migrate deploy

echo "[entrypoint] Starting Query Monitor..."
exec node_modules/.bin/next start -p "${PORT:-3000}"
