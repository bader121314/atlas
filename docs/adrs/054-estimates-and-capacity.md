# ADR-054: Estimates and weekly capacity (M9)

## Context

The workload view (ADR-047) counts open tasks per person and week, but a
week of five small tasks and a week of five large ones look the same. The
backlog asks for capacity planning.

## Decisions

- **Estimates.** Tasks gain an optional `estimateMinutes` (1 to 60,000,
  about 1,000 hours), checked in the database and recorded in task history.
  The task page reads `45m`, `4h` or `2h 30m`.
- **Capacity.** Each membership has an optional weekly capacity in minutes
  (0 to 10,080). People set their own; owners and admins set anyone's in
  their organization (`PUT /organizations/:slug/workload/capacity/:userId`).
  Capacity is per organization because people split time between them.
- **Workload.** Each week now also carries the estimated minutes of open
  work due that week. A task with several assignees contributes an equal
  share to each, so the team total equals the task's estimate. Weeks over
  capacity are marked in text ("over capacity") as well as colour. People
  with a capacity appear even with nothing assigned. The same project read
  rule applies (ADR-047): estimates on tasks the viewer cannot open are
  never counted.

## Not included

Spreading an estimate across the days between start and due date, and time
off and holidays. The task page does show time logged (ADR-049) against the
estimate, with any overrun.

## Gates

`tests/integration/workload.test.ts`: shared estimates, capacity
permissions (self, admin, refusal for others and outsiders), bounds, and
people with capacity but no work. The browser test sets an estimate and a
capacity.
