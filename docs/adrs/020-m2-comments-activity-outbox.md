# ADR-020: Comments, activity history and the transactional outbox

## Decisions

- **One transaction per change.** Creating or editing a task, and creating,
  editing or deleting a comment, writes the change, an `activity_events` row
  and an `outbox_events` row with the same database client. Either all three
  commit or none do; rejected changes (stale version, invalid state) leave no
  history or events behind. This satisfies "no event emitted before DB commit"
  (docs/02) once the M4 dispatcher publishes from the outbox after commit.
- **Activity is a summary, not a copy.** Changes record field names with
  from/to values for state, priority, assignee and due date, and only `true`
  for title and description. Comment bodies never appear in activity or
  outbox payloads. Activity rows cannot be updated (trigger); they are
  removed only with their project.
- **Outbox shape.** `aggregate_type = task`, `aggregate_id`, the task
  `version` after the change, `event_type` (`task.created`,
  `task.updated`, `comment.created|edited|deleted`) and a small payload.
  A partial index on unpublished events serves the future dispatcher.
- **Comment permissions.** Commenters, editors and managers may post. Only
  the author may edit. The author or a project manager may delete. Deletion
  is soft: the entry stays in the thread with its text removed.
- **Tenant scoping.** Comments reference tasks through
  `(organization_id, task_id)` and authors through organization memberships;
  every lookup goes through the guard-resolved organization, project and task
  number.
