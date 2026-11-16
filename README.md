# Atlas — Engineering Blueprint v1.0

**Date:** 2026-11-16

**Status:** M0 complete and verified in CI. M1 in progress: database-enforced tenancy rules (ADR-010) and account signup, verification and sessions (ADR-011). Product features remain design requirements.

**Owner:** Bader Altemane

**Product:** Multi-tenant collaborative work management SaaS.

## Run the M0 workspace locally

The repository root is this `atlas/` directory. Install Node.js 24 (tested with
24.22.0), pnpm 10.34.9, and Docker Desktop with Linux containers and Compose v2.
If pnpm is missing, install it with `npm install --global pnpm@10.34.9`.

```powershell
Copy-Item .env.example .env
# Edit .env: set POSTGRES_PASSWORD and MINIO_ROOT_PASSWORD to your own values.
# Set DATABASE_URL with the same PostgreSQL password, URL-encoded.
pnpm install --frozen-lockfile
docker compose up -d --build
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Web: [localhost:3000](http://localhost:3000). API liveness/readiness:
`http://127.0.0.1:3001/v1/health/live` and `/v1/health/ready`.
Worker exposes the same health routes on port 3002; it processes no jobs yet.
Web liveness is `/health/live`. Readiness returns 503 if PostgreSQL or Redis is
unavailable. Authentication routes live under `/v1/auth` (signup, verify-email,
login, logout, session); see `contracts/openapi.yaml` and ADR-011. In
development, verification emails are printed to the API console. Set
`SESSION_SECRET` and `WEB_ORIGIN` in `.env` before starting the API.

Mailpit's local inbox is at `http://127.0.0.1:8025` (SMTP 1025), and MinIO uses
9000/9001. These services are development-only. MinIO is built from a pinned
[upstream source release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
because the historical Hub image is no longer a dependable distribution path.
Its Docker build and all Compose image pulls still require verification on a
Docker host. No storage bucket, mail transport or upload workflow is implemented.

`pnpm dev` builds shared packages, then starts all three apps with source watchers.
Restart it after shared-package edits. `.env` stays untracked. Local data persists
in Compose volumes; `docker compose down` stops services without removing data.

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:dev # Uses ports 3000/3101/3102; stops its own processes afterwards.
pnpm test:integration # Requires running PostgreSQL/Redis and db:migrate first.
pnpm audit --prod --audit-level high
```

The checked-in CI workflow runs these checks and migrates a fresh ephemeral
PostgreSQL database before integration tests. CI itself has not been executed on
GitHub. E2E, seed, Terraform and deployment commands remain future milestones;
they are not implemented scripts. Product design and the full backlog follow.

## Product purpose

Implement a credible, robust, production-oriented collaborative workspace. The baseline requires role-secured organizations, project/task management, real-time collaboration, notifications, configurable workflow automation, search, files, analytics, integration APIs, and operational readiness. Do not confuse a working demo with independently verified production readiness.

## System defaults

- Monorepo: pnpm workspaces + Turborepo; TypeScript strict mode throughout.
- Web: Next.js 16 stable App Router, React, Tailwind CSS, shadcn/ui, TanStack Query, Zod, React Hook Form, dnd-kit, accessible components.
- API: NestJS REST API at `/v1`, OpenAPI 3.1 document, global input validation, explicit service/use-case boundaries.
- Data: PostgreSQL, Prisma ORM and hand-reviewed SQL migrations; UUIDv7/UUID identifiers; UTC timestamptz; database-side constraints.
- Auth: server-side opaque session IDs, hashed at rest, first-party HttpOnly Secure cookies, mandatory verified email for invitations, CSRF defenses and step-up MFA for sensitive operations. No localStorage bearer tokens.
- Real time: NestJS WebSocket gateway with secure short-lived handshake and room-scoped authorization; Redis pub/sub adapter; authoritative change events emitted from outbox after commit.
- Async: BullMQ + Redis; transactional outbox with separately processed dispatcher; idempotency tracking.
- Files: private S3-compatible object storage with short-lived signed transfers and malware scanning pipeline.
- Infra: local Docker Compose; staging/prod AWS via Terraform (ECS Fargate, ALB, RDS PostgreSQL, ElastiCache Redis, S3, CloudFront, Secrets Manager, CloudWatch).
- Quality: ESLint, Prettier, typecheck, unit/integration/E2E, OWASP ASVS 5 mapping, dependency/security scanning, performance and accessibility budgets.

## Documents

- [Product requirements and UX](docs/01-product-and-ux.md)
- [Architecture and technical decisions](docs/02-architecture.md)
- [Relational data and isolation model](docs/03-database.md)
- [API and events](docs/04-api-contract.md)
- [Authentication and security](docs/05-security.md)
- [Infrastructure and operations](docs/06-infrastructure.md)
- [Quality and test strategy](docs/07-quality.md)
- [Milestones, dependencies and acceptance](docs/08-milestones.md)
- [Representative OpenAPI contract](contracts/openapi-starter.yaml)

## Engineering nonnegotiables

1. Check organization membership and resource-level permission on _every_ read/write/subscription, with negative cross-tenant tests.
2. No unscoped `findUnique(id)` followed by trusting its result for tenant resources; query within authorized tenant boundary and verify ownership paths.
3. Make database writes and outbox messages atomic; consumers must be retryable and idempotent.
4. Audit authorization-sensitive mutations; never include secrets or sensitive contents in logs.
5. Keep schema, implementation, automated tests, and docs synchronized. Do not mark missing work complete.
6. No fake data or seeded users in production unless isolated demo accounts are intentionally provisioned.
7. Pin dependency versions after verifying supported combinations, and run security advisory checks before deployment.

## Decision precedence

Security and correctness > documented acceptance criteria > maintainable architecture > UX polish > raw feature count. Scope is preserved as backlog rather than silently abandoned.
