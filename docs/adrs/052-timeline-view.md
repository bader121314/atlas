# ADR-052: Start dates and the timeline view (M9)

## Context

The M9 backlog lists a richer Gantt view. Tasks only had due dates, so a
schedule could not show how long work runs.

## Decisions

- **Start dates.** Tasks gain an optional `startAt` (stored as a timestamp
  like `dueAt`; the web app sends noon UTC for a chosen day). A database
  check keeps a start on or before the due date whenever both are set, so
  every writer (API, automations, recurring tasks) is held to it; the API
  maps a violation to 400. Changes appear in task history like other fields.
- **Timeline view.** A fifth project view beside board, list, table and
  calendar: eight weeks from the week before the current one, moved four
  weeks at a time. Each task with a start or due date gets a bar from its
  start day to its due day (a round marker when it only has a due date);
  bars that continue outside the window have dashed ends. Unfinished work
  past its due date has a danger outline. Saved views can store it.
- **Accessibility.** It is a table: each row header is the task link with
  its dates written out ("Nov 3 to Nov 10, overdue"), so the bars are
  decoration (`aria-hidden`) rather than the only source of information.
  Forced-colours mode draws the bars with system colours. The keyboard
  shortcut is `i`, since `t` is the table.
- **Layout logic** is a pure function (`apps/web/lib/timeline.ts`) with unit
  tests for placement, clipping, overdue and counting.

## Not included

Dragging bars to reschedule, dependencies drawn as arrows, and milestone
markers on the grid. Dependencies already block completion (ADR-024);
drawing them needs a layout that stays readable with many links.

## Gates

`tests/timeline.test.ts`; the start-before-due rule, history and clearing in
`tests/integration/tasks.test.ts`; the browser test schedules a task and
finds it on the timeline, with an axe audit of the page.
