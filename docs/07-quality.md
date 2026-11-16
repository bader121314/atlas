# 07 — Quality Engineering, Test Matrix and Release Gates

## Quality strategy

Testing is a product requirement, not polish. Use risk-based verification at all boundaries: domain rules, HTTP, database, event processing, browser behavior, and deployments. Tests must fail under incorrect tenant context. Avoid untrustworthy coverage targets achieved by testing getters or mocking the behavior under test.

## Required test layers

| Layer               | Tools                                                              | What must be verified                                                                                  |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Static              | TypeScript strict, ESLint, Prettier, secret scan, dependency audit | No compilation, lint or known critical dependency errors                                               |
| Domain unit         | Vitest for pure logic; Jest if needed for Nest integrations        | Workflow transitions, priority rules, SLA/timezone logic, automation predicate evaluation, permissions |
| Backend integration | Testcontainers PostgreSQL and Redis, Supertest                     | HTTP validation, access control, Prisma transactions, durable outbox, idempotency, pagination          |
| Contract            | Generated OpenAPI client, schema tests                             | Request/response compatibility, RFC 9457 errors, documented endpoint behavior                          |
| Frontend component  | Testing Library and axe                                            | Forms, keyboard access, empty/error states, optimistic rollback                                        |
| End-to-end          | Playwright against isolated full-stack environment                 | Core user journeys, multi-user collaboration, file upload, notifications                               |
| Reliability         | k6 + fault-injection scripts                                       | Baseline throughput, race cases, WebSocket reconnect, queue retries, timeout behavior                  |
| Security            | OWASP ASVS 5 controls, ZAP baseline, manual threat tests           | CSRF, IDOR, injection, unsafe attachments, rate limiting, session lifecycle                            |
| Operations          | Staging smoke checks, backup restore exercise                      | Health checks, migrations, rollbacks, monitoring and recoverability                                    |

## Mandatory negative access tests

- User from org A requests org B task using a guessed UUID => no content exposed (404 where appropriate).
- Organization member without private-project membership attempts task GET/list/search/export => denied or omitted.
- WebSocket subscriber joins other tenant/project room => denied, no event leakage.
- User changes org ID in attachment signing request => denied.
- Token scoped read-only attempts mutation => denied.
- Revoked session/credential cannot access HTTP or establish a new WebSocket.
- User removed from project loses live subscriptions promptly and cannot access cached results.
- Worker receives stale or adversarial job with mismatched org/entity context => rejects and records safe error.
- Concurrent last-owner removal attempts cannot leave organization ownerless.

## Domain integrity tests

- Task creation + activity + outbox commits atomically; forced failure rolls all back.
- Optimistic version conflicts return 409 and preserve latest committed changes.
- Recurrence execution deduplicates across worker retries and restart.
- Automation rules cannot indefinitely self-trigger; recursion depth/quotas enforced.
- Dependency cycles rejected; workflow invalid transitions rejected.
- Pagination stable when many tasks share sort fields; cursor uses unique tie-breaker.
- Webhook retries are idempotent; replay cannot create duplicate core entities.
- Attachments cannot be downloaded while scan is pending, failed, or quarantined.

## Browser E2E scenarios

1. Register, verify email, sign in, create organization; become owner.
2. Invite a second user, accept invitation, assign a role, sign in separately.
3. Create project, add tasks, modify descriptions, assign team members, reorder Kanban.
4. Update a task concurrently in two browser contexts, surface a recoverable conflict.
5. Post comment and @mention; see notification and realtime update without reload.
6. Create private project; verify external organization member cannot discover it.
7. Upload a safe file; verify status processing and authorized download.
8. Turn on automation, trigger the event, verify exactly-once observable effect.
9. Export project data and verify access boundaries.
10. Test reduced motion, small viewport, keyboard-only navigation, and visible focus indicators.

## Acceptance and performance targets (hypotheses until measured)

- Accessibility: WCAG 2.2 AA goals for primary workflows; zero serious axe violations in automated primary flows plus manual keyboard/screen-reader spot checks.
- Core Web Vitals: LCP <=2.5s, INP <=200ms, CLS <=0.1 at p75 for defined demo device/network, verified with field data when available.
- API read p95 <300ms and mutation p95 <600ms under a _documented_ 100 concurrent user baseline on a defined test environment, excluding external email latency.
- Realtime: p95 event notification within 2s on same-region test environment; documented reconnect and missed-event recovery.
- Load scenario: 100 concurrent active users across >=10 organizations, a dataset >=100,000 tasks; record results rather than asserting success.
- SLO targets for a matured hosted environment: 99.9% monthly availability for core API, p95 latency and job age metrics; initial staging/demo makes no unconditional SLA claim.
- Coverage target: >=80% meaningful line coverage for domain packages, >=70% for API services, with 100% direct authorization rule coverage. Coverage is a guide, not a substitute for behavioral assertions.

## CI quality gates

On pull request: install with frozen lockfile; typecheck; lint; format check; tests; generated contract drift check; build; migration validation; dependency and secret scan; IaC format/validate. On main after checks: deploy staging, migrate safely, smoke and E2E, require explicit release approval for production. Do not merge on red CI without recorded exception and remediation owner.

## Evidence for portfolio

Publish versioned technical case studies with architecture diagram, sample trace, measured performance report (hardware/setup stated), test report, accessibility audit, threat model and explicit unresolved issues. Never claim production readiness or quantified performance without test artifacts.
