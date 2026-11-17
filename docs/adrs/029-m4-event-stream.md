# ADR-029: Project event stream over Server-Sent Events

## Context

Browsers on a board or task page should see other people's changes without
reloading. The planning documents assumed WebSockets.

## Decisions

- **Server-Sent Events instead of WebSockets.** Updates only flow from the
  server; every write already goes through the REST API with its Origin,
  session and permission checks. SSE is plain HTTP, so the same session
  cookie, guards and same-origin web proxy apply unchanged, browsers
  reconnect on their own and send `Last-Event-ID`, and no new dependency
  is needed (the workspace cannot add packages). If two-way messages are
  ever needed (typing indicators, cursors), a WebSocket endpoint can be
  added next to this one.
- **One stream per open project.** `GET .../projects/{key}/events` passes
  the same `SessionGuard`, `TenantGuard` and `ProjectGuard` as any read, so
  outsiders get the usual 404.
- **Access is rechecked while the stream is open.** Every 30 seconds the
  stream repeats the guards' checks (session, membership, project access).
  When any fails it sends `revoked` and closes; the integration test removes
  a member and sees their stream close.
- **Fan-out per instance.** Each API instance holds one Redis pattern
  subscription and hands events to its local streams, dropping ids it has
  seen recently. Tested with two API instances sharing Redis.
- **Replay and resync.** With `Last-Event-ID` the stream first replays
  published events since that event, ordered by publication time (an event
  committed late is still included), up to 200. Live events that arrive
  during the replay are held and sent after it, skipping duplicates. An
  unknown or pruned id, or more than 200 missed events, sends `resync`: the
  browser refetches its data.
- **Content never travels on the stream.** Frames carry the minimal
  envelope from ADR-028; browsers refetch through the API.
- Heartbeat comments every 25 seconds keep proxies from closing idle
  streams; `Cache-Control: no-transform` and `X-Accel-Buffering: no` stop
  buffering.

## Consequences

- Each open tab holds one HTTP connection; HTTP/2 in deployment removes the
  browser's per-host connection limit.
- Revocation takes effect within the recheck interval, not instantly.
  Removal events could close streams immediately later.
