# Atlas repository agent instructions

You are contributing to Atlas, an ambitious production-oriented collaborative workspace SaaS owned by Bader Altemane. Read README.md and ALL `docs/*.md` before substantial work; these are design requirements, not claims about existing implementation. Consult `contracts/openapi-starter.yaml` as an illustrative contract; expand it into a comprehensive validated OpenAPI spec as features are implemented.

## Required work protocol

1. Inspect git status, tree, package versions, docs and `implementation/SESSION_HANDOFF.md` before changes. Explain the target milestone and planned changes.
2. Break work into small reviewable commits/diffs but do not arbitrarily reduce product requirements or delete hard features from the roadmap. Prefer incremental delivery and preserve the future backlog.
3. Use TypeScript strict mode; no `any` escape hatches without a documented boundary. Validate external input; follow Nest module boundaries and consistent error format. Never let browser-provided tenant IDs establish authorization.
4. Implement domain behavior and tests together; include negative multi-tenant permission tests for every new data access path. Review database constraints/transactions and migration safety.
5. Keep credentials out of files/logs; use environment examples and managed secrets. Avoid introducing new hosted costs without explicit approval; local first.
6. Run all applicable checks actually available. Distinguish pass, failure and not-run; never invent commands or results. Do not claim deployed or production-ready unless verified.
7. Keep schema, OpenAPI, architectural docs, README and ADRs aligned with code changes.
8. Before stopping update `implementation/SESSION_HANDOFF.md` with commit, implemented functionality, tests/results, blockers, next tasks and important context. This is required for usage-limit interruptions.
9. Do not hardcode demo credentials in production. Provide safe local seed option only.
10. When instructions conflict, favor security, correctness and explicit acceptance criteria; document material tradeoffs and ask only when externally irreversible choices require approval.

## Architectural defaults

- pnpm monorepo / Turborepo; Next.js web, NestJS API, Nest worker, shared TS packages.
- PostgreSQL + Prisma; Redis/BullMQ; private object storage; outbox pattern; verified sessions with HttpOnly Secure cookies; CSRF controls; scoped realtime subscriptions.
- One tenant-aware query/permission pattern for all domain modules. Composite foreign keys to enforce organization consistency. No ad hoc tenant bypass.
- Start with M0 in `docs/08-milestones.md`, then sequential milestones. An explicit user instruction may redirect priority, but never silently abandon backlog.

## Definition of done

Feature has validated inputs, authorized flows, database integrity, tests (positive and negative), documented contract, accessible UI if applicable, observable failures, and verified deployment path if deployed. An unverified implementation is labeled as such.
