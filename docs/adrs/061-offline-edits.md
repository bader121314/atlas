# ADR-061: Keeping task edits made offline (M9)

## Context

The backlog lists offline editing. A fully offline app would cache pages
and task data on the device, which ADR-053 rules out: a shared or lost
device must not keep tenant data. The common case is narrower: someone
editing a task on a train loses the connection for a minute.

## Decisions

- **Scope:** changes to a task's fields on the task page (status,
  priority, assignees, dates, estimate, labels, milestone, title and
  description) made while the browser is offline, or when a save fails
  for lack of a connection.
- **Kept, merged, sent once.** Changes to one task merge (the latest value
  of each field wins) and are kept in memory and session storage, which the
  browser clears with the tab, never in long-lived storage. The page says
  the change is kept on the device.
- **No silent overwrites.** When the browser is back online the merged
  change is sent once with the version the person was looking at when they
  first edited offline. If someone else changed the task meanwhile, the
  server's version check (ADR-019) refuses it; the page shows the current
  version and says the offline changes were not saved. There is no
  automatic merge of conflicting edits.
- **Not included:** creating tasks or comments offline, and offline
  reading. Comment text stays in its box when posting fails, so nothing
  typed is lost.

## Gates

`tests/offline-edits.test.ts` for merging; the browser test goes offline,
changes a task, sees it kept, goes back online and sees it saved. Version
conflicts use the same path as online conflicts, covered by `tasks` tests.
