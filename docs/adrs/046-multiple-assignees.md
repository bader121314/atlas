# ADR-046: Multiple assignees

## Context

Tasks had one assignee since M2; `docs/03` planned a `task_assignees`
table. Rules, recurring tasks and analytics already write and read
`tasks.assignee_user_id` directly.

## Decisions

- **`task_assignees` holds everyone; `tasks.assignee_user_id` stays as the
  primary assignee.** Existing readers (analytics, exports, "open tasks per
  assignee", sorting) keep working on the primary.
- **A database trigger keeps them consistent for every writer.** Setting the
  primary adds them to the list, replacing it removes the previous primary,
  clearing it unassigns everyone. Automation rules and recurring tasks need
  no changes.
- **`PUT .../tasks/{n}/assignees`** replaces the list (up to ten people, each
  able to open the project); the current primary stays primary if kept,
  otherwise the first listed becomes primary. It bumps the task version and
  records the change in history.
- **Filtering by assignee matches anyone on the list**, including "me".
- **Newly added people are notified** (ids carried in the outbox payload),
  people already assigned are not notified again.
- Tasks expose `assignees` (primary first) next to `assignee`, so existing
  clients keep working.
