# ADR-019: Workflow states and tasks

## Decisions

- **Per-project workflow states** (`workflow_states`) with a category
  (`todo`, `in_progress`, `done`). New projects get To do, In progress, Done;
  the migration backfills existing projects. Custom states and allowed
  transitions (`docs/03` `workflow_transitions`) are deferred to M3 with the
  board; any state may move to any other state for now.
- **Human task keys.** Each project keeps `next_task_number`; creating a task
  increments it in the same transaction, giving gap-free keys like `NW-12`
  that never repeat (the counter is never decremented).
- **Database scoping.** Tasks carry `organization_id` and `project_id`; the
  state reference is the composite `(organization_id, project_id, state_id)`,
  so a task can only use a state of its own project. Assignee and creator
  references go through organization memberships. Tenant and project keys on
  tasks are immutable (triggers).
- **Assignment rule.** An assignee must be an active member who can see the
  project (same effective-role rule as ADR-018). Multiple assignees are
  deferred; one assignee covers the M2 exit flows.
- **Completion** is derived: moving into a `done` state sets `completed_at`
  (kept if already set), moving out clears it.
- **Concurrency.** `PATCH` requires `version`; the row is locked, the version
  compared, and a mismatch returns 409. Fields not sent are unchanged; `null`
  clears assignee or due date.
- **Archived projects are read-only:** task writes return 409.
- **Listing.** Filters `state`, `assignee` (`me`, `none` or a user id) and
  `priority`; keyset pagination on task number (`after`, `limit` ≤ 100,
  `nextCursor`), which stays stable while tasks are added. Unknown query
  parameters are rejected.

Activity history and outbox events for task changes follow in the next
change (ADR-020).
