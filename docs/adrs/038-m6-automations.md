# ADR-038: Automation rules

## Decisions

- **Rules are data.** A project manager defines a trigger (task created,
  task changed status, optionally to one status, comment added), optional
  conditions (priority, label, unassigned) and one to five actions (assign,
  set priority, add label, move to status, comment). The API validates the
  shape with Zod and checks that every state, label and person exists in
  the project or organization.
- **Run by the worker from the outbox.** A loop claims outbox events not yet
  handled (`automations_at IS NULL`, `SKIP LOCKED`) and evaluates the
  project's enabled rules against the task as it is now. Each
  `(rule, event)` pair is recorded in `automation_runs` with a unique key
  before anything changes, in the same transaction as the changes, so a
  rule runs at most once per event even if the worker restarts.
- **Changes look like anyone else's.** Actions write the task, an activity
  row (with the rule's name) and an outbox event, so history, live
  updates, notifications and webhooks all see them. The rule acts as the
  person who created it and fails if they can no longer edit the project.
- **Loop protection.** Events caused by a rule carry `{ ruleId, depth }`.
  A rule never reacts to its own change, and nothing runs past depth 3, so
  two rules that undo each other stop after three steps; the skipped run
  says why. The integration tests build both loops.
- **All or nothing per rule.** Each rule's actions run inside a savepoint;
  if one cannot apply (say the assignee left), the rule's other changes are
  undone and the run is recorded as failed with the reason.
- **Simulation.** `POST .../automations/simulate` reports which of the
  latest 50 tasks the conditions would match now, without changing
  anything, so a manager can check a rule before saving it.

## Consequences

- Rules run within a second or so of the change, not inside the request.
- Recurring tasks, schedules and webhooks as actions are later additions on
  the same run table.
