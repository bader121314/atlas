#!/usr/bin/env bash
# One-time setup for a dev container or Codespace (ADR-062). Generates a
# local .env, starts PostgreSQL and Redis, installs and migrates.
set -euo pipefail
cd "$(dirname "$0")/.."

secret() { node -e "console.log(require('crypto').randomBytes(${1:-32}).toString('base64url'))"; }

if [ ! -f .env ]; then
  password="$(secret 18)"
  if [ -n "${CODESPACE_NAME:-}" ]; then
    origin="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  else
    origin="http://localhost:3000"
  fi
  sed \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${password}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://atlas:${password}@127.0.0.1:5432/atlas|" \
    -e "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$(secret 18)|" \
    -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(secret 32)|" \
    -e "s|^WEBHOOK_SECRET_KEY=.*|WEBHOOK_SECRET_KEY=$(secret 32)|" \
    -e "s|^WEB_ORIGIN=.*|WEB_ORIGIN=${origin}|" \
    .env.example > .env
fi

docker compose up -d postgres redis
corepack enable
pnpm install --frozen-lockfile
pnpm --filter "./packages/*" build
until docker compose exec -T postgres pg_isready -U atlas >/dev/null 2>&1; do sleep 1; done
pnpm db:migrate
echo
echo "Ready. Run: pnpm dev, then open port 3000."
echo "Verification links for new accounts are printed in the pnpm dev output."
