# 11 — M3 Exit Report: Polished Navigation and Views

**Status:** complete, with the deferrals listed below.
**Date:** 2026-11-17.
**Scope reference:** `docs/08-milestones.md`, M3.

## Exit criteria and evidence

| Exit criterion                              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard access and main WCAG checks        | Shortcuts (`?` lists them), Escape to leave a field, a skip link, and a keyboard control on every board card (ADR-023, PR #23). The browser smoke test opens the shortcut list, creates a task and switches views with the keyboard only, and checks the skip link is the first Tab stop. axe-core audits every screenshot against WCAG 2.2 A/AA; `tests/design-tokens.test.ts` checks contrast (ADR-027). |
| Multi-viewport E2E                          | `scripts/ui-smoke.cjs` loads the organization, board, table and task pages at 390 px and 820 px wide as well as desktop, audits each, and fails if any page scrolls sideways.                                                                                                                                                                                                                              |
| Equivalent filtered results across views    | Board, list, table and calendar render one server-filtered task list (ADR-025), so a filter cannot differ between layouts. `tests/integration/tasks.test.ts` and `saved-views.test.ts` cover the filters and stored view configs; the smoke test applies a filter, saves a shared view and switches layouts.                                                                                               |
| Version conflicts explained and recoverable | A stale edit answers 409 (`tasks.test.ts`); the task page then shows the other person's version and explains how to reapply. A failed board move puts the card back and says why (ADR-023).                                                                                                                                                                                                                |

## Delivered

| Area          | Delivered                                                                                     | Decision record |
| ------------- | --------------------------------------------------------------------------------------------- | --------------- |
| Workflow      | Custom states with safe deletion (tasks move to a chosen state)                               | ADR-022         |
| Board         | Drag-and-drop and keyboard moves with rollback                                                | ADR-023         |
| Planning      | Task dependencies with database cycle protection; milestones with progress                    | ADR-024         |
| Views         | Filters, table with sorting, month calendar, saved views (private or shared)                  | ADR-025         |
| Custom fields | Text, number, date and choice-list fields with typed storage and validation                   | ADR-026         |
| Design system | Colour and spacing tokens, contrast test, accessibility audit, phone and tablet layout checks | ADR-027         |
| Keyboard      | Shortcuts, shortcut list, skip link                                                           | PR #23          |

**Test totals at exit:** 122 unit tests and 87 integration tests against real
PostgreSQL and Redis, plus the browser smoke test (three users, three
viewports, accessibility audit on every page it captures).

## Deferred, with reasons

| Item                                                                                                                                        | Status and reason                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Transition rules between states                                                                                                             | Any move between states is allowed. Rules add configuration UI with little value until teams ask for them.                         |
| Ordering within a board column                                                                                                              | Cards are ordered by task number. Manual ordering needs a rank column and conflict handling; planned with real-time updates in M4. |
| Server-side sorting                                                                                                                         | The table sorts the loaded set (up to 2,000 tasks), which is adequate for project-sized lists.                                     |
| Filtering and sorting by custom fields                                                                                                      | The typed value columns make this a query change; not needed for the exit flows.                                                   |
| Manual screen reader and keyboard audit                                                                                                     | Automated checks cover a subset of WCAG. A manual pass with NVDA and VoiceOver is listed for M7 (hardening).                       |
| Multiple assignees, OpenAPI client generation, request IDs in audit events, trusted-proxy client addresses, change password while signed in | Carried over from M1 and M2; none blocks M4.                                                                                       |

## Next: M4

Real-time updates and notifications: publish outbox events after commit,
stream project events to signed-in browsers, presence, in-app notifications
and an email worker, with reconnect and backfill.
