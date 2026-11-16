# Atlas session handoff

**Date:** 2026-11-16 (Asia/Riyadh).
**Milestone:** M0 complete in CI; M1 in progress (schema and sessions done).
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

**Merged (PR #2):** migration `20261116120000_m1_identity_organizations`,
ADR-010. Database-enforced active-owner invariant, composite tenant FK for
inviters, immutable `organization_id`, no ownership via invitation, one
outstanding invitation per email, 32-byte token digests, normalized emails.
Tests: `tests/integration/identity-tenancy.test.ts`.

**Done (PR #3, branch `m1/auth-sessions`):** ADR-011. Routes under `/v1/auth`:
signup (202 for new and existing emails), verify-email, login (uniform 401),
logout, session. Argon2id via `node:crypto`, opaque 256-bit tokens with HMAC
digests, HttpOnly SameSite=Lax cookie, global exact-Origin guard on writes,
development console mail transport. Tests: `tests/auth-primitives.test.ts`
(unit) and `tests/integration/auth-flow.test.ts`. CI: 20 unit + 20
integration tests passing.

**Next, in order:**

1. Rate limiting with Redis (per IP and per account on login, signup,
   verify-email) with 429 responses; resend-verification endpoint.
2. Password reset (single-use digest token, uniform responses, revoke all
   sessions on reset); session list and revoke-all.
3. `audit_events` table and audit entries for login, logout, password reset,
   membership and invitation changes.
4. Tenant request context and deny-by-default membership guard; organization
   create/list/switch; negative cross-tenant HTTP tests.
5. Invitations and membership management (accept, revoke, role change,
   removal) on top of the ADR-010 constraints.
6. Anti-CSRF token alongside the Origin check, once web forms exist.
7. Web UI: signup, verify, login, organization switcher, invite and members.
8. M1 exit demo: 2 organizations and 3 accounts proving isolation.

## Environment and versions

Node 24.22.0, pnpm 10.34.9, Next 16.4.6, React 19.3.1, Nest 11.2.10,
Prisma 7.10.1, TypeScript 5.9.3, Turbo 2.11.11, Zod 4.6.7, Vitest 5.1.0.
Lockfile is authoritative. ESLint 9.39.5 emits a deprecation warning; upgrade
together with typescript-eslint. GitHub Actions warns that checkout/setup-node
and pnpm action v4 target Node 20; bump when convenient.

Env names: NODE_ENV, API_PORT, WORKER_PORT, DATABASE_URL, REDIS_URL,
SESSION_SECRET, WEB_ORIGIN, POSTGRES_USER, POSTGRES_DB, POSTGRES_PASSWORD,
MINIO_ROOT_USER, MINIO_ROOT_PASSWORD. Never commit values.

## Standing decisions and limits

- SQL migrations are authoritative; keep `schema.prisma` in sync by hand.
- Repositories use parameterized SQL via `pg` (ADR-011). In tests, inject
  Nest dependencies with explicit `@Inject(...)`; do not rely on emitted
  decorator metadata.
- Commits are authored as Bader; no AI attribution in commits, PRs or repo
  files outside `AGENTS.md` and `implementation/`.
- Shared packages build before consumers; restart `pnpm dev` after editing them.
- MinIO community distribution changed; the local image builds from a pinned
  upstream release. Choose maintained storage before M5.
- AWS region, domain, budget and providers remain open. Do not provision paid
  services without explicit approval.
- No production-readiness or performance claims.
