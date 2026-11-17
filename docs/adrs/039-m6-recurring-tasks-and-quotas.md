# ADR-039: Recurring tasks and worker quotas

## Decisions

- **A recurrence is a template with a schedule.** Title, description,
  priority, optional assignee and due offset, repeating every 1 to 12 days,
  weeks or months from a first occurrence. Editors and managers create
  them; anyone who can read the project sees them.
- **One task per occurrence, created by the worker.** The worker claims due
  recurrences with `SKIP LOCKED`, creates the task (with its number,
  activity and outbox event, so live updates, notifications, webhooks and
  rules all see it) and moves the recurrence to its next occurrence in the
  same transaction.
- **No catching up.** If the worker was down, the next occurrence is the
  first one after now; one task is created, not a backlog. Monthly
  recurrences keep their day, clamped to the end of shorter months, and all
  dates are UTC.
- **Acts as its creator.** If the creator can no longer edit the project,
  or the project is archived, the recurrence turns itself off.
- **Worker quotas.** Rule applications are limited per organization to
  1,000 an hour; runs beyond it are recorded as skipped with "quota", so
  one organization's rules cannot monopolise the worker. Webhook deliveries
  are bounded by per-endpoint backoff and pausing (ADR-036), exports by
  three waiting per person (ADR-035).
