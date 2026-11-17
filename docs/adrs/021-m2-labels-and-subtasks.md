# ADR-021: Labels and subtasks

## Decisions

- **Labels belong to the organization** (as in `docs/03`) and are shared by
  all its projects. Names are unique per organization ignoring case. Colors
  are a fixed set of tokens (`slate`, `sea`, `sage`, `sand`, `rose`,
  `violet`) so the palette stays accessible. Owners, admins and members may
  create labels; only owners and admins may delete one, which removes it from
  every task.
- **Applying labels** replaces a task's full set (`PUT …/tasks/{n}/labels`).
  Every label must belong to the caller's organization (composite foreign
  key in the database, checked by the API first). The change increments the
  task version and is recorded in activity and the outbox like any edit.
- **Subtasks** use `tasks.parent_task_id`. The composite foreign key
  `(organization_id, project_id, parent_task_id)` keeps parent and child in
  the same project. A trigger rejects loops and nesting deeper than five
  levels; the API maps those to 400. Parents are addressed by task number.
- **Filters:** `label` (id) and `parent` (task number or `none` for
  top-level tasks).
- The web task page gains label checkboxes and a parent field; board cards
  show labels and the parent key.

## Deferred

Custom workflow states and transition rules (M3, with drag-and-drop on the
board), multiple assignees, and generating a typed client from OpenAPI.
