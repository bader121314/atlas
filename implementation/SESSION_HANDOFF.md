# Atlas session handoff

**Date:** 2026-11-16 (Asia/Riyadh).
**Milestone:** M0 complete in CI; M1 in progress (database foundation).
**Repository:** https://github.com/bader121314/atlas (public). Default branch `main`.
**Workflow:** work on a branch, open a pull request, merge only with green CI.
**Deployments:** none; no paid resources provisioned.

## Status

### M0 — done (CI-verified)

GitHub Actions (`.github/workflows/ci.yml`) passes on `main`: frozen install,
format, lint, build, typecheck, unit tests, Prisma validate/generate, migrate
from an empty PostgreSQL 17 database, integration tests against live
PostgreSQL/Redis, and `pnpm audit --prod --audit-level high`.

PR #1 fixed two defects found on first CI run:

- Readiness always returned 503: the Redis client used
  `commandsQueueMaxLength: 1`, which rejects node-redis handshake commands
  ("The queue is full"). Removed; 2 s timeouts still bound the probe.
- `pnpm test` used an unquoted `--exclude tests/integration/**`; the shell
  expanded it and extra paths became positional filters. Replaced by Vitest
  projects `unit` and `integration` (`--project unit|integration`).

Not verified on the owner's laptop: Docker Compose startup, the MinIO source
build and Mailpit. Docker Desktop and WSL are installed there, but the laptop
was low on free disk space. CI covers PostgreSQL/Redis, so this is not blocking.

### M1 — in progress

**Done (branch `m1/identity-schema`, PR pending):** migration
`20261116120000_m1_identity_organizations` and ADR-010. Tables: users,
sessions, verification_tokens, organizations, organization_memberships,
invitations. Database-enforced rules: active-owner invariant (deferred
triggers), composite tenant FK for inviters, immutable `organization_id`,
no ownership via invitation, one outstanding invitation per email, 32-byte
token digests only, normalized unique emails. Covered by
`tests/integration/identity-tenancy.test.ts`; the same scenarios were also
checked by hand against PostgreSQL 16.

**Next, in order:**

1. Auth primitives in a shared package: Argon2id password hashing, 256-bit
   opaque tokens, HMAC-SHA256 digests with a server secret
   (`SESSION_SECRET`, documented by name only), unit tests.
2. API: signup with email verification (Mailpit locally), login, logout,
   session revocation; HttpOnly Secure SameSite cookies; uniform responses to
   resist account enumeration; rate limiting.
3. CSRF: exact Origin check plus token on cookie-authenticated writes.
4. Tenant-aware request context and deny-by-default membership policy guard;
   organization creation/switching; negative cross-tenant HTTP tests.
5. Invitations and membership management (accept, revoke, change role, remove)
   with audit events for sensitive changes; `audit_events` table.
6. OpenAPI for all new routes; contract tests.
7. Web UI: signup, login, organization switcher, invite and member screens.
8. M1 exit demo: 2 organizations and 3 accounts proving isolation.

## Environment and versions

Node 24.22.0, pnpm 10.34.9, Next 16.4.6, React 19.3.1, Nest 11.2.10,
Prisma 7.10.1, TypeScript 5.9.3, Turbo 2.11.11, Zod 4.6.7, Vitest 5.1.0.
Lockfile is authoritative. ESLint 9.39.5 emits a deprecation warning; upgrade
together with typescript-eslint. GitHub Actions warns that checkout/setup-node
and pnpm action v4 target Node 20; bump when convenient.

Env names: NODE_ENV, API_PORT, WORKER_PORT, DATABASE_URL, REDIS_URL,
POSTGRES_USER, POSTGRES_DB, POSTGRES_PASSWORD, MINIO_ROOT_USER,
MINIO_ROOT_PASSWORD. Never commit values.

## Standing decisions and limits

- SQL migrations are authoritative; keep `schema.prisma` in sync by hand.
- Shared packages build before consumers; restart `pnpm dev` after editing them.
- MinIO community distribution changed; the local image builds from a pinned
  upstream release. Choose maintained storage before M5.
- AWS region, domain, budget and providers remain open. Do not provision paid
  services without explicit approval.
- No production-readiness or performance claims.
