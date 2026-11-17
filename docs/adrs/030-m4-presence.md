# ADR-030: Task presence

## Decisions

- **Ephemeral, in Redis only.** Each task has a sorted set
  `atlas:presence:{org}:{task}` of user ids scored by expiry time. A
  heartbeat (`PUT .../tasks/{n}/presence`) adds the caller with a 45-second
  expiry, removes expired entries and returns who is present. Nothing about
  presence is written to PostgreSQL or kept after it expires.
- **Same access rules as reading the task.** The endpoint passes the usual
  guards (`task.read`); names are only returned for active members of the
  organization, so someone removed mid-heartbeat disappears.
- **Heartbeats, not pushes.** The task page sends a heartbeat every 20
  seconds while visible and a `DELETE` with `keepalive` when it closes.
  Others see arrivals within 20 seconds and departures at once (or within
  45 seconds if the tab crashed). Publishing presence on the event stream
  would be quicker but adds traffic for every tab; not needed yet.
- If Redis is unavailable the endpoint answers 503 and the page shows no
  presence; nothing else is affected.
