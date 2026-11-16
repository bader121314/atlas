# Atlas session handoff

**Date:** 2026-11-16 (Asia/Riyadh).
**Milestone:** M0 foundation implemented; Docker exit gates remain open.
**Branch:** main.
**Implementation commit:** `d7c4134fbf2be33f455ab8226fbc2b3b995f1b3c` (foundation; subsequent commit updates handoff and whitespace).
**Deployments:** None; no paid resources provisioned.

## Installation continuation — 2026-11-16

User authorized installing WSL and Docker Desktop. Installation is now verified:

- Docker Desktop 4.99.0 at `C:\Program Files\Docker\Docker`.
- Docker CLI 29.9.3 and Compose v5.7.0.
- WSL 3.0.5.0 with kernel 6.18.58.1-1.
- VirtualMachinePlatform enabled successfully; Windows reports RestartNeeded=True.
- AMD Ryzen 7 5800H firmware virtualization and second-level address translation
  both report True. No BIOS change is needed based on this check.

**Next action: user must restart Windows.** No automatic restart was initiated.
Docker engine is not running yet; containers, migrations and integration tests
remain unverified. After restart, start Docker Desktop, verify `docker info`, then
continue the remaining M0 gates. Do not reinstall Docker or WSL unnecessarily.

Diagnostic logs: `C:\Users\17176\atlas-wsl-package.log` (Successfully installed),
`C:\Users\17176\atlas-virtualization-setup.log` (feature setup and firmware check),
and `C:\ProgramData\DockerDesktop\install-log-admin.txt`.
Docker installer hash matched the official winget manifest. Earlier slow WSL
fallback downloads in the user's Temp directory are no longer needed.
Earlier validation results below describe the original implementation session.

## Repository and changed files

Initially only Atlas_Codex_Engineering_Blueprint_v1.zip existed. Its `atlas/`
directory was extracted and initialized as the Git/workspace root. Open this
nested directory for future sessions. The ZIP remains outside the repository.
All blueprint content and the full backlog are preserved; Prettier normalized
formatting.

- Root configs: package.json, pnpm-lock.yaml, pnpm-workspace.yaml, turbo.json,
  strict TypeScript, ESLint, Prettier, .node-version, .gitignore, .env.example.
- apps/web: Next App Router foundation page and /health/live.
- apps/api and apps/worker: Nest HTTP services, loopback listeners, shutdown,
  typed startup config, /v1/health/live and /v1/health/ready.
- packages/config, contracts, shared, ui: environment validation, health schema,
  bounded PostgreSQL/Redis probes, safe RFC 9457 errors and design tokens.
- packages/database: Prisma 7 config/schema/client generation, reviewed SQL
  baseline and migration lock. Only system_metadata exists; no tenant records.
- docker-compose.yml and infrastructure/local/minio/Dockerfile: PostgreSQL,
  Redis, source-built MinIO and Mailpit. Loopback ports and required .env passwords.
- .github/workflows/ci.yml: frozen install, formatting, lint, build, typecheck,
  tests, schema/client checks, fresh migration/integration and runtime audit.
- tests and scripts: environment tests, real Nest HTTP checks, PostgreSQL/Redis
  integration test, dev smoke check, env-aware database command wrapper.
- README, contracts/openapi.yaml and docs/adrs/009-m0-foundation.md document the
  implemented boundary. openapi-starter.yaml remains a future product design.

## Versions and actual validation

Official npm registry was queried with npm view before installation. Pinned:
Node 24.22.0, pnpm 10.34.9, Next 16.4.6, React 19.3.1, Nest 11.2.10,
Prisma 7.10.1, TypeScript 5.9.3, Turbo 2.11.11, Zod 4.6.7, Vitest 5.1.0,
tsx 4.23.15. See lockfile for complete resolution. Next/Prisma engine constraints
were verified compatible with Node 24. ESLint 9.39.5 emits a deprecation warning;
upgrade the tooling together after checking typescript-eslint compatibility.

pnpm is not globally installed here. pnpm commands below were run through
`npm exec --yes --package=pnpm@10.34.9 -- pnpm ...`. Registry DNS and loopback HTTP
were blocked in the sandbox and rerun successfully after escalation.

| Command                                                  | Actual result                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| node --version                                           | v24.22.0                                                                                      |
| pnpm install --frozen-lockfile                           | PASS; up-to-date lockfile                                                                     |
| pnpm typecheck                                           | PASS; eight packages plus root tests/config                                                   |
| pnpm test                                                | PASS; 2 files, 9 tests                                                                        |
| pnpm build                                               | PASS; eight packages including Next production build                                          |
| pnpm smoke:dev                                           | PASS twice; pnpm dev served home and all 3 liveness routes, then its process tree was stopped |
| eslint .                                                 | PASS after switching Node scripts to ESM                                                      |
| prettier --check .                                       | PASS                                                                                          |
| node scripts/database.mjs validate                       | PASS; schema valid                                                                            |
| node scripts/database.mjs generate                       | PASS; Prisma Client 7.10.1 generated                                                          |
| pnpm audit --prod --audit-level high                     | PASS; no known vulnerabilities found                                                          |
| docker --version                                         | Unavailable; executable not installed                                                         |
| Compose build/up, pnpm db:migrate, pnpm test:integration | NOT RUN; Docker/PostgreSQL/Redis unavailable                                                  |
| GitHub CI                                                | NOT RUN; workflow only, no remote configured                                                  |

Earlier test failures exposed malformed URL parsing and missing test dependencies;
both were corrected. HTTP tests verify both Nest services, 404 for unimplemented
domain endpoints, safe problem responses and 503 readiness with unavailable
dependencies. No domain data access exists yet; isolation acceptance remains M1.

## Architecture and limits

ADR-009 records the M0 boundary. Worker only exposes infrastructure health; no
BullMQ jobs or outbox dispatch yet. Shared packages build before consumers;
restart dev after shared-package edits. The database contains only infrastructure
metadata; identity and composite tenant constraints arrive with M1 tests.
No authentication, business flows, generated product client, E2E or deployment
is claimed. CI's broader contract drift, secret scanning and IaC gates expand
with the relevant milestones. No production readiness or performance claims.

## Remaining M0 gates

1. Install Docker Desktop/Compose, fill ignored .env from .env.example, build/pull
   services and verify MinIO source build and image versions on the Docker host.
2. Migrate from an empty PostgreSQL database, run integration tests and positive
   readiness checks; confirm repeat migration is a no-op.
3. Run CI on a remote repository before marking the milestone complete.
4. MinIO community distribution/maintenance changed. Source build pins the final
   upstream release; choose maintained storage before M5. Local development only.

## Ordered M1 continuation

1. Close the M0 Docker gates first.
2. Implement reviewed identity/session/organization migrations with composite
   tenant foreign keys, ownership consistency and isolated integration fixtures.
3. Add deny-by-default membership/resource policies with cross-tenant,
   private-project and concurrent last-owner tests before domain repositories.
4. Implement verified-email signup/recovery, password hashing, opaque hashed
   sessions, secure cookies, CSRF/origin checks, revocation and abuse controls.
5. Add organizations/switching, invites/membership, request instrumentation and
   sensitive mutation audit. Expand OpenAPI and behavioral contract tests.
6. Connect accessible auth/invite/member UI and prove 2-org/3-account isolation.

## Environment names and decisions

NODE_ENV, API_PORT, WORKER_PORT, DATABASE_URL, REDIS_URL, POSTGRES_USER,
POSTGRES_DB, POSTGRES_PASSWORD, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD.
Future auth/email secrets must be documented by names only when implemented.
AWS region, domain, budget and providers remain open; do not provision paid
services without explicit approval.
