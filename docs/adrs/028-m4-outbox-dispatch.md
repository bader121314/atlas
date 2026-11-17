# ADR-028: Outbox dispatch

## Context

Since M2 every task change writes an `outbox_events` row in the same
transaction as the change (ADR-020). M4 needs those events delivered to
every API instance so browsers can be told about changes.

## Decisions

- **The worker publishes, the API never does.** A loop in `apps/worker`
  claims unpublished rows with `FOR UPDATE SKIP LOCKED`, publishes each to a
  Redis pub/sub channel per project (`atlas:events:{org}:{project}`) and
  marks them published in the same transaction. Uncommitted rows are
  invisible to it, so no event is ever published before its change commits.
- **Several workers are safe.** `SKIP LOCKED` hands each row to one worker;
  an integration test runs two dispatchers at once and checks that each
  event is published exactly once.
- **At least once, deduplicated by id.** If a worker stops after publishing
  but before committing, the event is published again. Every event has a
  UUID and consumers drop ids they have seen.
- **Failures back off per event.** A failed publish increments
  `attempt_count` and sets `next_attempt_at` (1 s doubling, capped at five
  minutes); the batch stops at the first failure. Order across events is not
  guaranteed, so clients never apply event contents: they refetch.
- **Minimal envelope.** `{ id, type, organizationId, projectId, taskId,
version, actorUserId, occurredAt }` and nothing else: no titles, no field
  values. Anything a browser shows is fetched through the API, which applies
  the normal access checks, so a mistake in event routing cannot leak data.
- **Replay window.** Published rows are kept for 24 hours so reconnecting
  browsers can replay what they missed (`project_id, published_at` index),
  then pruned by the worker.

## Consequences

- Redis pub/sub is fire-and-forget: an API instance that is disconnected
  from Redis misses events. Browsers recover through the replay window or a
  full refetch (ADR-029).
- Event latency is bounded by the poll interval (500 ms when idle). LISTEN/
  NOTIFY could wake the worker sooner; not needed yet.
