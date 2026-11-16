# 08 — Implementation Milestones, Dependencies, Acceptance Gates

## Principles

Each milestone is a deployable, reviewable vertical slice. Maintain the _full scope_ in backlog, even while staging the release. Implement foundation and core product before optional advanced capabilities. No dates are hard commitments. Every phase ends with automated evidence, user-flow demo, handoff update, and architecture/documentation changes.

**Progress:** M0 and M1 complete (see `docs/09-m1-exit-report.md`); M2 next.

## M0 — Specification and developer environment

**Deliver:** versioned docs, ADRs, `AGENTS.md`, pnpm/Turborepo skeleton, apps/web, apps/api, apps/worker, packages/shared, packages/ui, packages/config, Docker Compose for PostgreSQL/Redis/MinIO/Mailpit, config validation, `.env.example`, CI checks.
**Exit:** clean checkout runs `pnpm install --frozen-lockfile`, `pnpm dev`, basic health route, database migrations from zero, lint/typecheck/test/build. No secrets in repo; README accurately describes what actually works.

## M1 — Identity, organizations, tenancy and secure base

**Deliver:** identity model, email verification and recovery, opaque hashed sessions with secure cookies, CSRF protections, session revocation, org creation and switch, invites and membership, project-scoped authorization abstraction, initial audit and request instrumentation.
**Exit:** 2 organizations and 3 accounts demonstrate isolation and allowed access; permissions and CSRF negative tests pass; owner preservation transactional test; audit entry for sensitive changes. Login, invite, membership removal usable in UI.

## M2 — Work management vertical slice

**Deliver:** projects, workflows/states/transitions, tasks/subtasks, assignments, priority, due dates, labels, comments, activity feed, filters and stable cursor pagination; schema migrations, version conflict handling, OpenAPI codegen and quality checks.
**Exit:** 2 signed-in users in same project can create, assign, update and comment; cross-tenant and private-project failures tested; task edits create transactionally consistent activity/outbox rows. Board/list views functional.

## M3 — Polished navigation and views

**Deliver:** design system, keyboard-first navigation, board drag-and-drop with rollback, table and calendar, custom fields, saved views, milestones, task dependencies and cycle detection, responsive/error/empty states.
**Exit:** keyboard access and main WCAG checks, multi-viewport E2E, equivalent filtered results across views, version conflicts explained and recoverable.

## M4 — Realtime and notifications

**Deliver:** authenticated WebSocket connections, Redis adapter, outbox dispatcher, presence (ephemeral), task updates and comments over project-scoped rooms, user notifications, email worker, reconnect/backfill strategy.
**Exit:** multi-instance simulated delivery verified; org/project revocation cuts access; no event emitted before DB commit; retry/dedup tests; disconnected clients resynchronize.

## M5 — Attachments, search and analytics

**Deliver:** presigned uploads, content sniffing, malware scan/quarantine, signed downloads, PostgreSQL full-text search with tenant-scoped query plans, task/project analytics, exports in background jobs.
**Exit:** unsupported/bad files rejected; quarantined cannot be fetched; search doesn't reveal private projects; dashboard numbers reconcile with database; export respects policy and expires.

## M6 — Automation and integration platform

**Deliver:** versioned rules/conditions/actions with editor and simulation, recurrence, worker quotas, API token scopes, outbound webhooks with signing/SSRF prevention and delivery history, OpenAPI client/SDK sample.
**Exit:** rules idempotently execute on triggered events; loop/recursion protection; signed webhooks retry safely; replay endpoint and SSRF-negative tests pass.

## M7 — Hardening, production staging and observability

**Deliver:** AWS Terraform stacks (web, API, worker, db, cache, storage, CDN, DNS/TLS, observability), environments, deployment automation, SLO dashboards, alerts, backup/restore, runbooks, disaster exercise, security reviews and load-test baselines.
**Exit:** staging rebuild from repo reproducible, rollback demonstrated, restore exercised, multi-tenant security test suite passes, measured performance report includes limitations.

## M8 — Public portfolio release

**Deliver:** isolated demo tenant, optional safe seeded demo accounts, polished README, screenshots, demo walkthrough, component/system diagrams, ADRs, engineering case study, short video, live uptime/status page if budget permits.
**Exit:** external evaluator can try key flows; no sensitive personal data; demo works without privileged credentials; claims limited to verified results.

## M9 — Advanced expansion backlog (scope preserved)

Potential candidates: fine-grained ABAC, public share views with strict data fences, full notification preferences/digests, richer Gantt and workload capacity, time tracking, SSO/SAML, SCIM provisioning, enterprise audit exports, API event subscriptions, multi-region DR, search index service, billing and metering, mobile/PWA features. Each requires ADR, data and threat model, and acceptance gates.

## Dependency graph

M0 -> M1 -> M2 -> M3. M2 -> M4 and M5. M4 -> M6. M3+M4+M5+M6 -> M7 -> M8. M9 is deliberate ongoing expansion, not a license to silently drop requirements.

## Milestone handoff template

- Milestone and branch/commit:
- Implemented behavior (verified):
- Commands executed and results:
- Schema or contract changes:
- New architectural decisions:
- Known bugs, risks, deferred requirements:
- Next specific tasks (ordered):
- Required secrets/env names (never secret values):
