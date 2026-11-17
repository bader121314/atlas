#!/usr/bin/env bash
# Release drill (ADR-044): builds the stack from the repository, deploys the
# current release, rolls back to the previous one against the new schema,
# and restores a database backup into a fresh database. Needs Docker.
#
#   scripts/release-drill.sh <current-ref> <previous-ref>
set -euo pipefail

CURRENT=${1:-HEAD}
PREVIOUS=${2:-HEAD~1}
NET=atlas-drill
PG_PASSWORD=drill-only-password
SECRET=drill-only-session-secret-0123456789abcdef
ORIGIN=http://127.0.0.1:3000
DB_URL="postgresql://atlas:${PG_PASSWORD}@postgres:5432/atlas"
log() { printf '\n== %s\n' "$*"; }

cleanup() {
  docker rm -f drill-postgres drill-redis drill-api drill-worker drill-web >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  git worktree remove --force /tmp/atlas-previous >/dev/null 2>&1 || true
}
trap cleanup EXIT

build() { # build <dir> <tag>
  for target in api worker migrate; do
    docker build -q -f "$1/infrastructure/docker/Dockerfile" --target "$target" -t "atlas-$target:$2" "$1" >/dev/null
  done
  docker build -q -f "$1/infrastructure/docker/Dockerfile" --target web \
    --build-arg API_ORIGIN=http://drill-api:3001 -t "atlas-web:$2" "$1" >/dev/null
}

app_env() {
  echo -e "--network $NET -e DATABASE_URL=$1 -e REDIS_URL=redis://drill-redis:6379 \
-e SESSION_SECRET=$SECRET -e WEB_ORIGIN=$ORIGIN -e TRUST_PROXY=1 -e NODE_ENV=production"
}

start_app() { # start_app <tag> <database url>
  # shellcheck disable=SC2046
  docker run -d --name drill-api $(app_env "$2") "atlas-api:$1" >/dev/null
  # shellcheck disable=SC2046
  docker run -d --name drill-worker $(app_env "$2") "atlas-worker:$1" >/dev/null
  docker run -d --name drill-web --network "$NET" -p 127.0.0.1:3000:3000 "atlas-web:$1" >/dev/null
  for _ in $(seq 1 60); do
    if curl -fsS "$ORIGIN/api/health/ready" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  docker logs drill-api | tail -20
  echo "release $1 did not become ready"
  return 1
}

stop_app() { docker rm -f drill-api drill-worker drill-web >/dev/null; }

migrate() { # migrate <tag> <database url>
  docker run --rm --network "$NET" -e DATABASE_URL="$2" "atlas-migrate:$1"
}

psql_count() { # psql_count <database> <sql>
  docker exec drill-postgres psql -U atlas -d "$1" -Atc "$2"
}

log "Build the current release ($CURRENT) and the previous one ($PREVIOUS)"
build . current
git worktree add --force /tmp/atlas-previous "$PREVIOUS" >/dev/null
build /tmp/atlas-previous previous

log "Start PostgreSQL and Redis"
docker network create "$NET" >/dev/null
docker run -d --name drill-postgres --network "$NET" -e POSTGRES_USER=atlas \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB=atlas postgres:17.7-alpine >/dev/null
docker run -d --name drill-redis --network "$NET" redis:7.4.7-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec drill-postgres pg_isready -U atlas -d atlas >/dev/null 2>&1 && break
  sleep 1
done
DB_URL="postgresql://atlas:${PG_PASSWORD}@drill-postgres:5432/atlas"

log "Deploy the previous release, then upgrade to the current one"
migrate previous "$DB_URL"
start_app previous "$DB_URL"
stop_app
migrate current "$DB_URL"
start_app current "$DB_URL"
curl -fsS -X POST "$ORIGIN/api/auth/signup" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -d '{"email":"drill@example.test","password":"a sufficiently long password","displayName":"Drill"}' -o /dev/null -w '%{http_code}\n'
USERS=$(psql_count atlas "SELECT count(*) FROM users")
test "$USERS" = 1

log "Roll back: the previous release runs against the current schema"
stop_app
start_app previous "$DB_URL"
curl -fsS "$ORIGIN/api/health/ready"
echo
stop_app

log "Back up, restore into a fresh database, and serve from it"
docker exec drill-postgres pg_dump -U atlas -d atlas -Fc -f /tmp/atlas.dump
docker exec drill-postgres createdb -U atlas atlas_restored
docker exec drill-postgres pg_restore -U atlas -d atlas_restored --no-owner /tmp/atlas.dump
RESTORED_URL="postgresql://atlas:${PG_PASSWORD}@drill-postgres:5432/atlas_restored"
migrate current "$RESTORED_URL"
test "$(psql_count atlas_restored "SELECT count(*) FROM users")" = "$USERS"
start_app current "$RESTORED_URL"
curl -fsS "$ORIGIN/api/health/ready"
echo

log "Release drill passed: rebuild, upgrade, rollback and restore"
