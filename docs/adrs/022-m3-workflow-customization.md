# ADR-022: Workflow customization

## Decisions

- **Managers own the workflow.** Adding, renaming, recategorizing,
  reordering and deleting states requires `project.update` (project manager,
  or organization owner/admin). Everyone who can read tasks can read states.
- **Stable keys, editable labels.** A state's key is derived from its first
  label (`in_review`, then `in_review_2`) and never changes, so filters and
  history stay valid after renames. Up to 20 states per project.
- **Category drives completion.** Changing a state's category updates
  `completed_at` for its tasks in the same transaction, so "completed" always
  matches the column a task sits in.
- **Reordering** must list every state exactly once; anything else is 400.
- **Safe deletion.** Deleting a state with tasks requires `moveTo`, another
  state of the same project; its tasks move in the same transaction, get a
  version bump, and each gets an activity and outbox entry (`state` from/to).
  Without tasks, `moveTo` is optional. The last state cannot be deleted (409).
- **Transitions stay open.** Any state may move to any other; transition
  rules from `docs/03` remain on the backlog until a team needs them, since
  they add friction for small teams and the board makes moves visible.
- The project page gains a "Workflow" section for managers; the browser smoke
  test adds a status and sees its new column.
