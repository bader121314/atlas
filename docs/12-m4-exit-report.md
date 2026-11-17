# 12 — M4 Exit Report: Real-time Updates and Notifications

**Status:** complete, with the deferrals listed below.
**Date:** 2026-11-17.
**Scope reference:** `docs/08-milestones.md`, M4.

## Exit criteria and evidence

| Exit criterion                         | Evidence                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-instance delivery verified       | `tests/integration/event-stream.test.ts` starts two API instances sharing PostgreSQL and Redis; one published event reaches the streams on both. `outbox-dispatcher.test.ts` runs two dispatchers at once and gets each event exactly once. |
| Org and project revocation cuts access | `event-stream.test.ts`: removing a member, or making the project private, sends `revoked` and closes that person's stream; outsiders get 404 and signed-out callers 401. The inbox hides notifications about projects no longer readable.   |
| No event emitted before the DB commit  | `outbox-dispatcher.test.ts`: an outbox row in an open transaction is not published; after commit it is. Notifications are created from the same committed rows.                                                                             |
| Retry and deduplication                | Failed publishes back off per event (`outbox-dispatcher.test.ts`); duplicate deliveries are dropped by event id (`event-stream.test.ts`); notifications are unique per recipient and event, and re-running the notifier creates none.       |
| Disconnected clients resynchronize     | `event-stream.test.ts`: reconnecting with `Last-Event-ID` replays the missed events in order; an unknown or pruned id sends `resync` and the browser refetches. The browser smoke test shows a second tab updating without a reload.        |

## Delivered

| Area          | Delivered                                                                                    | Decision record |
| ------------- | -------------------------------------------------------------------------------------------- | --------------- |
| Outbox        | Worker dispatcher with SKIP LOCKED claims, per-event backoff, 24-hour replay window, pruning | ADR-028         |
| Event stream  | Server-Sent Events per project with guard rechecks, Redis fan-out, replay and resync         | ADR-029         |
| Web           | Live project and task pages with a status indicator; no overwriting of text being typed      | PR #27          |
| Presence      | Who else is viewing a task, ephemeral in Redis                                               | ADR-030         |
| Notifications | Assignment and comment notifications, inbox and unread count, delayed email with an opt-out  | ADR-031         |

**Test totals at exit:** 129 unit tests and 104 integration tests, plus
the browser smoke test, which now runs the worker and checks a live update,
an inbox notification and the email it sends.

## Deferred, with reasons

| Item                                     | Status and reason                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| WebSockets                               | Replaced by Server-Sent Events (ADR-029): updates are one-way and writes stay on REST. Revisit for two-way features.           |
| Mentions, watchers, digests, quiet hours | Notifications cover assignment and comments; mention parsing and per-kind preferences come with richer comment editing.        |
| Production email transport               | Development prints emails to the worker log and production refuses to send; a provider integration is part of deployment (M7). |
| Instant revocation                       | Streams recheck access every 30 seconds; closing them on the removal event itself is an optimization.                          |
| Board ordering within a column           | Still by task number (from M3).                                                                                                |

## Next: M5

Attachments, search and analytics: presigned uploads with content checks,
PostgreSQL full-text search scoped to the tenant, task and project analytics,
and background exports.
