# 02 — System Architecture and ADRs

## Context and deployment diagrams

Browser -> Next.js web (same origin; `/api/*` is proxied) -> NestJS REST API -> PostgreSQL, Redis, S3-compatible storage. Live updates reach the browser as Server-Sent Events from the API, authenticated by the session cookie and checked against project membership (ADR-029). The worker runs PostgreSQL `SKIP LOCKED` loops for the outbox, notifications, uploads, exports, rules, recurrences, webhooks and domain checks (ADR-028, ADR-031). An API transaction writes the change, its history and an outbox row together; the dispatcher publishes committed rows to Redis and consumers dedupe by event id.

The diagram in the [README](../README.md#architecture) shows the same picture.

> The original specification named WebSockets and BullMQ. They were replaced by Server-Sent Events and database-backed loops; see ADR-029 and ADR-028.

## Monorepo layout

```
atlas/
  apps/web/            # Next.js App Router
  apps/api/            # NestJS modular API + WS
  apps/worker/         # NestJS worker application
  packages/ui/         # reusable accessible design primitives
  packages/contracts/  # OpenAPI-generated client/types + Zod schemas
  packages/config/     # lint, TS, shared tooling
  packages/database/   # Prisma schema/migrations/seeds
  packages/observability/
  infrastructure/terraform/{modules,environments}/{...}
  docs/{adrs,architecture,runbooks,security}
  tests/{e2e,load,security}
  .github/workflows/
  docker-compose.yml
  pnpm-workspace.yaml
  turbo.json
  AGENTS.md
```

## Backend module boundaries

Identity & Sessions; Organizations & Membership; Teams; Projects & Workflows; Tasks & Dependencies; Comments & Mentions; Files; Search; Notifications; Automations; Analytics & Reporting; Audit; Webhooks & Integrations; Realtime; Import/Export; Admin/Operations.
Each domain module owns controllers, use cases/services, repository contracts, DTOs, policies, events and tests. Dependencies are directed inward, with domain services free of transport-layer objects. Cross-domain coordination through application-level orchestrators and durable events where appropriate; avoid cyclical module references.

## Data consistency

- PostgreSQL is authoritative source of truth. Redis is ephemeral cache/queue infrastructure, not source of record for user content.
- Use DB transactions for task mutation + activity/audit + outbox insertion. Assign server-generated event IDs and monotonically increasing resource versions.
- API supports `If-Match`/expected version for potentially conflicting edits, returns 409 or 412 with current version and reconciliation payload.
- Maintain project-scoped ordered `position` keys for boards (fractional ranking or LexoRank-style approach), rebalance as background or transactional operation; avoid O(n) updates per move.
- Dependency graph validity checked transactionally with concurrency safety; restrict cycles and self edges. Use advisory or serializable locking strategy for critical graph updates.
- On event publish failures, retry outbox; on consumer failures, exponential retry then DLQ; dedupe side effects by `(consumer,event_id)` unique key.
- Realtime is best-effort notification of authoritative state; clients resync via API on reconnect, cursor gap, permission changes or missed events.

## Caching

Cache only derived, non-sensitive or explicitly tenant-keyed data with TTL and invalidation. Cache keys include org ID, project scope, role/version when relevant. Disable shared Next.js caching for tenant/user-specific pages and responses; review framework caching semantics for version-specific vulnerabilities. No stale authenticated data served cross-tenant.

## Search

Phase 1: PostgreSQL full-text search with GIN indexes plus trigram as needed, scoped to authorized tenant/project. Phase 2: dedicated search service only when benchmark justifies; index from outbox and verify authorization at query time. Never rely on search index ACL state alone.

## Scalability and failure modes

- Horizontally scale API and worker independently; externalize sessions, socket coordination and queues.
- WebSocket gateway should accept reconnects, send limited replay cursor where retention allows, and fall back to authenticated API refetch.
- Worker shutdown finishes in-flight jobs or safely redelivers; use deterministic idempotency keys.
- Graceful API shutdown, readiness depends on critical services, liveness remains lightweight.
- Circuit breakers and bounded retries for email/webhooks, avoid retry storms.
- Enforce per-tenant quotas for uploads, automations, API rates and noisy neighbor protections.

## Key architecture decisions (ADRs)

- ADR-001 Modular monolith: lower cross-service consistency cost and clearer portfolio reasoning than early microservices.
- ADR-002 One PostgreSQL cluster with tenant foreign keys: consistent relational queries, cost-effective initial operations. Enforce application-level authorization, scoped compound keys and optional defense-in-depth RLS where feasible; never rely on a header alone.
- ADR-003 First-party cookie sessions over browser-stored JWT: revocable, avoids exposing bearer tokens to JavaScript.
- ADR-004 Explicit REST/OpenAPI baseline over GraphQL: predictable contracts, permissions and tooling; add GraphQL only with a concrete need.
- ADR-005 Outbox for durable notification of database changes; no direct publish assumed atomic with DB commit.
- ADR-006 AWS ECS Fargate instead of Kubernetes for initial hosting: genuine cloud skills without avoidable cluster operations; add K8s lab separately if desired.
- ADR-007 Server-authoritative task state; collaborative presence is ephemeral, no CRDT for task editing.
- ADR-008 Independent NestJS Worker; same repo/type contracts, independently scalable runtime.

## Dependency mapping

Web -> generated contract client -> API controllers -> application policies/services -> repositories -> database. API -> outbox rows. Dispatcher/worker -> Redis jobs -> domain handlers -> database + external providers. Realtime gateways consume published authorized event descriptors, validate subscriber authorization and send minimal payloads.

## Engineering review gates

Review tenancy, secure session design, conflict behavior, reliability of events, DB migration safety, rollback, failure testing and observability before considering infrastructure 'production ready'.
