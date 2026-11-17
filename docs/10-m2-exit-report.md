# 10 — M2 Exit Report: Work Management Vertical Slice

**Status:** complete, with the deferrals listed below.
**Date:** 2026-11-17.
**Scope reference:** `docs/08-milestones.md`, M2.

## Exit criteria and evidence

| Exit criterion                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two signed-in users in the same project can create, assign, update and comment | `tests/integration/labels-subtasks.test.ts` ("collaboration in one project"): an owner and a member each create tasks, assign each other, one updates the other's task, both comment, and the activity history attributes each step to the right person. The browser smoke test performs the same flow in Chrome.                                    |
| Cross-tenant and private-project failures tested                               | `projects.test.ts` (private projects invisible to non-members, guests capped at commenter, same key in two organizations, foreign members rejected); `tasks.test.ts` (another organization's owner gets 404, another project's state rejected); `comments-activity.test.ts` and `labels-subtasks.test.ts` (foreign comments and labels unreachable). |
| Task edits create transactionally consistent activity and outbox rows          | `comments-activity.test.ts`: each change writes its activity row and outbox event; a stale version or invalid state writes neither.                                                                                                                                                                                                                  |
| Board and list views functional                                                | `.github/workflows/ui-smoke.yml`: Alice creates a project, adds three tasks, moves and assigns one, comments, and the board shows it in the right column.                                                                                                                                                                                            |

## Delivered

| Area          | Delivered                                                                                                                                       | Decision record |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Projects      | Organization-wide or private projects, per-project roles, `ProjectGuard`, archiving                                                             | ADR-018         |
| Tasks         | Per-project states, human keys (`NW-12`), priority, assignee, due date, completion tracking, filters, keyset pagination, optimistic concurrency | ADR-019         |
| Collaboration | Comments, field-level activity history, transactional outbox                                                                                    | ADR-020         |
| Organization  | Labels, subtasks with loop and depth protection                                                                                                 | ADR-021         |
| Web           | Project list and creation, board and list views, task page with editing, labels, subtasks, comments, history and conflict handling              | PRs #14, #15    |

**Test totals at exit:** 79 unit tests and 74 integration tests against real
PostgreSQL and Redis, plus the browser smoke test.

## Deferred, with reasons

| Item from the M2 plan                       | Status and reason                                                                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom workflow states and transition rules | Moves to M3 with drag-and-drop on the board, where the rules are visible to users. Today every project has To do, In progress, Done, and any move is allowed.                                                  |
| Multiple assignees                          | One assignee covers the exit flows; the `task_assignees` design in `docs/03` remains the plan.                                                                                                                 |
| Generated OpenAPI client                    | The contract (`contracts/openapi.yaml`) is maintained by hand and request/response shapes are shared through `@atlas/contracts` Zod schemas. Client generation and contract tests against the spec move to M3. |
| Outbox dispatcher                           | Events are written now; publishing them after commit is M4 (real-time and notifications).                                                                                                                      |

## Next: M3

Polished navigation and views: design system, keyboard-first navigation,
board drag-and-drop with rollback, table and calendar views, custom fields,
saved views, milestones, task dependencies with cycle detection, and the
deferred workflow customization.
