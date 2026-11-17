# Atlas session handoff

**Date:** 2026-11-16 (Asia/Riyadh).
**Milestone:** M0, M1 and M2 complete (`docs/09`, `docs/10`); M3 next.
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

### M1 — complete

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

**Merged (PR #7):** ADR-015. `/v1/organizations`
create/list, `/{slug}` get/patch, `/{slug}/members`. `TenantGuard` resolves
slug + active membership (404 for outsiders, 403 for insufficient role);
routes must declare `@RequirePermission`; policy matrix in
`organizations/policy.ts`, pinned by `tests/organization-policy.test.ts`.
2-org/3-account isolation tests in `tests/integration/organizations.test.ts`
(memberships beyond owners inserted directly until invitations exist). Test
helper now exposes `api.api(method, path)` for any `/v1` route.

**Merged (PR #8):** ADR-016. Invite/list/revoke
under `/v1/organizations/{slug}/invitations`, accept at
`/v1/invitations/accept` (email must match), role change and removal/leave
under `/{slug}/members/{userId}`. Admins cannot create or touch admins or
owners (`canInviteAs`, `canChangeRole`, `canRemove` in policy.ts); last-owner
violations return 409; removal sets `state = 'removed'`. Tests:
`tests/integration/invitations.test.ts`, extended policy unit tests. CI: 51
unit + 55 integration tests.

**Merged (PR #9):** ADR-017. Next.js pages for signup,
login, verify-email, forgot/reset password, organizations (list, create,
detail with members, invitations, role changes, leave), accept invitation and
account sessions. `/api/*` is proxied to the API. Plain CSS in
`app/globals.css`. Browser smoke test `.github/workflows/ui-smoke.yml` +
`scripts/ui-smoke.cjs` (3 users, 13 screenshots, uploaded as artifact).
Anti-CSRF token deliberately deferred (see ADR-017).

**Merged (PR #10):** M1 exit report, README screenshots, browser smoke test
now covers member removal.

### M2 — complete

PRs #11–#15 (ADR-018 to ADR-021); exit report `docs/10-m2-exit-report.md`.
Shared test fixture: `tests/integration/support/fixtures.ts` (accounts,
organizations, invitations, `call()` helper, cleanup of all tenant tables;
add new tables to its cleanup list).

### M3 — complete

PRs #17–#23 (ADR-022 to ADR-027); exit report `docs/11-m3-exit-report.md`.
Note: local Prettier 3.8 differs from the project's 3.10 on long union types;
keep them on one line. The local workspace may have no `node_modules`; CI is
the type and lint check. Playwright labels match substrings: use
`{ exact: true }` (the shortcut dialog is labelled "Keyboard shortcuts").

### M4 — complete

PRs #25–#29 (ADR-028 to ADR-031); exit report `docs/12-m4-exit-report.md`.
The worker runs the outbox dispatcher, the notifier and the email sender;
the smoke job starts it with `NOTIFICATION_EMAIL_DELAY_MS=0`.

### M5 — complete

PRs #31–#34 (ADR-032 to ADR-035); exit report `docs/13-m5-exit-report.md`.
Storage settings: `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`,
`STORAGE_SECRET_KEY` (optional `STORAGE_REGION`, `STORAGE_STYLE`). The smoke
job runs the S3 test double from `packages/shared/dist/testing/fake-s3.js`.
Worker jobs each have their own busy flag (a shared one starved exports).

### M6 — complete

PRs #36–#40 (ADR-036 to ADR-039); exit report `docs/14-m6-exit-report.md`.
Worker loops: outbox dispatcher, notifier, email, attachment checks,
exports, webhook planner and sender, automations, recurrences. Each outbox
consumer has its own `*_at` marker; pruning waits for all of them.
Settings added: `WEBHOOK_SECRET_KEY` (and development-only
`WEBHOOK_ALLOW_HTTP`, `WEBHOOK_ALLOWED_HOSTS`).

### M7 — next (hardening, staging, observability)

Read `docs/08` M7 and `docs/06`. No cloud credentials are available here,
so infrastructure work is code plus validation (`terraform validate` is not
installed; keep modules small and documented). Suggested order:

1. Done (PR #41): request ids in responses, problem details, audit events
   and JSON request logs; `TRUST_PROXY` for client addresses (ADR-040).
2. Done (PR #42): Prometheus metrics on the API and worker behind
   `METRICS_TOKEN`: HTTP by route pattern, outbox lag, worker backlogs and
   batch results (ADR-041).
3. Done (PR #43): one Dockerfile with api, worker, web and migrate targets,
   non-root runtime, health checks, `LISTEN_HOST`; `compose.app.yml`; CI
   builds the images; job timeouts and Vitest hook timeouts (ADR-042).
4. Done (PR #44): Terraform for AWS (VPC, ECS Fargate with Service Connect,
   RDS, ElastiCache, S3, ALB, Secrets Manager, alarms) validated in CI;
   runbooks for deploy, rollback, backup and restore, outbox lag (ADR-043).
5. Security review notes and a small load test script (no dependency).
6. Carry-overs: change password while signed in, multiple assignees,
   mentions.

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
