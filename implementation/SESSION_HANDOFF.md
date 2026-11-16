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

**Merged (PR #3):** ADR-011. Routes under `/v1/auth`:
signup (202 for new and existing emails), verify-email, login (uniform 401),
logout, session. Argon2id via `node:crypto`, opaque 256-bit tokens with HMAC
digests, HttpOnly SameSite=Lax cookie, global exact-Origin guard on writes,
development console mail transport. Tests: `tests/auth-primitives.test.ts`
(unit) and `tests/integration/auth-flow.test.ts`. CI: 20 unit + 20
integration tests passing.

**Merged (PR #4):** ADR-012. Redis fixed-window
limits per address and per account on login, signup, verify-email and the
new resend-verification route; 429 with Retry-After; fails closed (503) when
Redis is down; identities hashed in keys. Tests:
`tests/integration/rate-limits.test.ts`. Integration tests override
`RateLimitSettings` with a unique prefix and generous limits.

**Merged (PR #5):** ADR-013. Password
reset request/confirm (1-hour single-use links, reset revokes every session
in the same transaction), session list, revoke one (own only; others' ids
return 404) and revoke-others. Tests: `tests/integration/account-security.test.ts`
using the shared helper `tests/integration/support/auth-app.ts` (use it for
new auth-dependent integration tests).

**Merged (PR #6):** ADR-014. Append-only
`audit_events` (triggers block update/delete/truncate), `AuditService` writing
in the same transaction as the change, events for every account action,
coarsened IPs, no secrets. Tests: `tests/ip-summary.test.ts`,
`tests/integration/audit-log.test.ts`. Test cleanup cannot delete audit rows;
that is expected.

**Done (PR #7, branch `m1/organizations`):** ADR-015. `/v1/organizations`
create/list, `/{slug}` get/patch, `/{slug}/members`. `TenantGuard` resolves
slug + active membership (404 for outsiders, 403 for insufficient role);
routes must declare `@RequirePermission`; policy matrix in
`organizations/policy.ts`, pinned by `tests/organization-policy.test.ts`.
2-org/3-account isolation tests in `tests/integration/organizations.test.ts`
(memberships beyond owners inserted directly until invitations exist). Test
helper now exposes `api.api(method, path)` for any `/v1` route.

**Next, in order:**

1. Invitations and membership management (invite, accept, revoke, role
   change, removal, ownership transfer) on top of ADR-010 constraints; add
   policy actions and audit events; replace direct membership inserts in
   tests with invitations.
2. Anti-CSRF token alongside the Origin check, once web forms exist.
3. Web UI: signup, verify, login, organization switcher, invite and members.
4. Smaller follow-ups: change password while signed in, email notice after
   a reset, request IDs in audit events.
5. M1 exit demo: 2 organizations and 3 accounts proving isolation.

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
