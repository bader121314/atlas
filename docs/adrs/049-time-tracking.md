# ADR-049: Time tracking (M9)

## Decisions

- **Entries, not timers.** People log minutes (1 to 1440) against a task
  for a day, with an optional note of up to 500 characters. A running timer
  needs state that survives tabs and devices; logged entries cover the same
  need with nothing to reconcile. The web form reads `45m`, `1h 30m`,
  `1.5h` and `1:30`.
- **Who.** Anyone who can read the task sees its entries and total. Editors
  and managers log their own time (`task.write`); the author or a project
  manager removes an entry. Entries cannot be edited: remove and log again.
  Days more than one day ahead of UTC are refused.
- **Report.** `GET /organizations/:slug/time?from&to` (at most 93 days)
  totals minutes per person and project. Owners and admins see everyone;
  everyone else sees only their own time. Either way only projects the
  caller can read count, so the report cannot reveal private projects or
  their size.
- **Storage.** `time_entries` has composite tenant foreign keys to the task
  and the membership, so entries go when a task or a membership goes, and
  the tenant key is immutable (ADR-007 pattern).

## Threat model and gates

- Cross-tenant reads and deletes return 404; a viewer cannot log; an editor
  cannot remove someone else's entry; a member's report excludes other
  people and private projects they cannot open
  (`tests/integration/time-tracking.test.ts`).
- Totals are not exported or sent in webhooks yet; adding them later must
  keep the same project-read check.
