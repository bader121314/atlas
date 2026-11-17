# 14 — M6 Exit Report: Automation and Integrations

**Status:** complete, with the deferrals listed below.
**Date:** 2026-11-17.
**Scope reference:** `docs/08-milestones.md`, M6.

## Exit criteria and evidence

| Exit criterion                             | Evidence                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rules execute idempotently on their events | `tests/integration/automations.test.ts`: a rule applies once to a matching task, not to others, and running the worker again changes nothing; `automation_runs` is unique per rule and event and written in the same transaction as the changes. |
| Loop and recursion protection              | The same test builds two rules that undo each other (they stop after three steps, the fourth is skipped as "depth limit") and a rule that would retrigger itself (skipped as "own change").                                                      |
| Signed webhooks retry safely               | `tests/integration/webhooks.test.ts`: the receiver verifies the HMAC signature; a 500 is retried with the same event id; planning twice creates no second delivery; an endpoint that keeps failing is paused.                                    |
| Replay endpoint                            | The same test replays a delivered event and the receiver gets the same event id again.                                                                                                                                                           |
| SSRF-negative tests                        | Saving refuses private, loopback, metadata and `localhost` addresses; sending refuses `localhost` after DNS resolution and a literal loopback address, and the receiver is never reached (`webhooks.test.ts`, `webhooks-security.test.ts`).      |

## Delivered

| Area            | Delivered                                                                                                                     | Decision record |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Webhooks        | Signed deliveries from the outbox, SSRF checks before saving and after DNS, retries, pausing, history                         | ADR-036         |
| API tokens      | Personal tokens with `tasks:read` and `tasks:write` scopes, limited to task routes                                            | ADR-037         |
| Automations     | Rules with triggers, conditions and actions, run once per event, loop protection, simulation                                  | ADR-038         |
| Recurring tasks | Tasks created on a schedule without catching up; worker quotas                                                                | ADR-039         |
| Samples         | `examples/atlas-client.mjs` (token client with pagination) and `examples/webhook-receiver.mjs` (signature check), both tested | PR #40          |

**Test totals at exit:** about 185 unit tests and 131 integration tests,
plus the browser smoke test.

## Deferred, with reasons

| Item                                          | Status and reason                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Rule versioning                               | Rules are edited in place and every run records its outcome; keeping old versions matters once rules are shared or audited. |
| Generated OpenAPI client                      | The contract is maintained by hand and no generator can be installed here; the samples show the intended use.               |
| Webhooks as rule actions, schedules for rules | The run table and outbox make these additions, not redesigns.                                                               |
| Per-token rate limits                         | Tokens share the per-user limits of the routes they call; separate limits come with public API documentation.               |

## Next: M7

Hardening and staging: infrastructure as code, deployment automation,
observability, backups and restore drills, security review and load
baselines.
