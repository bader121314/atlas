# ADR-033: Project analytics

## Decisions

- **Computed on request with SQL, from the tasks themselves.** Totals,
  tasks per status, overdue and unassigned counts, created and finished per
  week (eight weeks, Monday starts, UTC), median lead time (creation to
  completion, tasks finished in the last 90 days) and open tasks per
  assignee. Nothing is cached or copied, so the numbers always agree with
  the task lists; the integration test checks them against the rows.
- **"Lead time", not "cycle time".** Atlas does not record when work
  started, so the honest measure is creation to completion. A state-change
  history query could give cycle time later.
- **Same access as reading tasks.** The endpoint is per project behind the
  usual guards; anyone who can read the project can see its numbers.
- **Accessible presentation.** The dashboard uses tables with captions; the
  bars beside weekly numbers are decorative and hidden from assistive
  technology, so the data is never only visual.

## Consequences

- Each request runs five small aggregate queries on indexed columns; fine
  for project-sized data. Materialized summaries are the next step if
  projects grow to hundreds of thousands of tasks.
