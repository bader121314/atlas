# ADR-024: Task dependencies and milestones

## Decisions

- **Dependencies are "A blocks B" edges inside one project.** Both ends
  reference `(organization_id, project_id, task id)`, so a dependency can
  never cross a project or tenant. Cross-project dependencies stay on the
  backlog (`docs/03` asks for an explicit policy first).
- **Loops are refused by the database.** A trigger walks the existing graph
  from the new blocked task and rejects the insert if it reaches the blocker
  (and self-dependencies are a CHECK). The API answers 400; duplicates 409.
- **Dependencies are informational.** A blocked task can still be moved; the
  task page shows open blockers so people can decide. Enforcement ("cannot
  finish while blocked") can be layered on later without schema changes.
- **Every add and remove is recorded** as `dependency.added` /
  `dependency.removed` activity with an outbox event, in the same transaction.
- **Milestones belong to a project**, have an optional due date and an
  open/closed status, and report task and done counts. Tasks reference them
  through a composite key; deleting a milestone sets the reference to null
  (`ON DELETE SET NULL (milestone_id)`), keeping tasks and their tenant keys.
  Managers create, edit and delete milestones; editors assign tasks to them.
- Filters: `milestone` (id or `none`).
