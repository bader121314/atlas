# ADR-047: Team workload view (M9)

## Decision

`GET /organizations/{slug}/workload?weeks=1..12` returns, for each person
with open assigned tasks, how many are overdue, due in each of the next
weeks (UTC Monday starts), due later, or have no due date. The web page
shows it as a table with shading that supports, never replaces, the
numbers.

## Data and threat model

- **What could leak:** counts of tasks in private projects would reveal that
  such work exists and who does it. Only projects the viewer can open are
  counted (the same rule as the project guard, inside the query); archived
  projects are excluded.
- **Who:** organization members (`members.read`); guests cannot see the
  team, as with the member list.
- Assignment comes from `task_assignees` (ADR-046), so shared tasks count
  for everyone on them; finished tasks never count.

## Acceptance gates

- A member without access to a private project does not see work there,
  even for people who do (`tests/integration/workload.test.ts`).
- Guests get 403; out-of-range `weeks` gets 400.
- Totals equal the sum of overdue, weekly, later and undated counts.
