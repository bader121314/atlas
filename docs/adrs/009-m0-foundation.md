# ADR-009: M0 foundation and implementation boundary

The extracted blueprint lives in `atlas/`, which is the Git and workspace root.
Node 24 LTS, pnpm 10, Next.js 16 and NestJS 11 are pinned after npm registry
queries. Prisma 7 supports Node 24; its datasource URL lives in prisma.config.ts.
Exact package versions and transitive resolution are recorded in pnpm-lock.yaml.

M0 creates only infrastructure metadata in PostgreSQL. Identity, sessions,
organizations and composite tenant foreign keys arrive together with M1 behavior
and isolation tests. No public domain data access is available in M0.

API and worker expose `/v1/health/live` and `/v1/health/ready` over loopback HTTP.
Readiness checks PostgreSQL and Redis. Worker currently runs a Nest HTTP process
for health only; BullMQ processing and outbox dispatch remain scheduled work.
Web exposes `/health/live`. Local services bind only to loopback.

`contracts/openapi.yaml` describes implemented infrastructure routes. The original
starter contract and all product requirements remain unchanged as the backlog.
Generated product clients, authorization, full instrumentation and deployment
remain future milestone work. M0 is not production readiness.

Versions were verified with `npm view` against registry.npmjs.org. Framework
requirements: https://nextjs.org/docs/app/getting-started/installation and
https://docs.nestjs.com/migration-guide; Prisma Node support was verified with
`npm view prisma@7.10.1 engines`. Node 24.22.0 is the installed runtime.

Docker is unavailable on the implementation host. Compose image pulls, startup,
database migration execution and full service integration need Docker validation.
MinIO uses a local Docker build from the final pinned upstream community release,
instead of the retired Docker Hub distribution. The build remains unverified.
It is local development infrastructure only, pending a maintained storage decision
before M5. Source: https://github.com/minio/minio/releases.
