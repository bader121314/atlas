# ADR-056: Usage metering (M9)

## Context

Billing is on the backlog, but choosing a payment provider and plans needs
hosted accounts and business decisions. What Atlas can do now is measure:
plans are priced on seats and usage, and owners want to see both.

## Decisions

- **Size, computed on request:** active members and guests, active and
  archived projects, tasks, and attachment storage (pending, quarantined and
  clean files; rejected files are deleted).
- **Metered counts per UTC month** in `usage_counters` (organization,
  first day of the month, metric, count): `api_requests` (requests
  authenticated with an API token), `scim_requests`, `webhook_deliveries`
  (successful attempts) and `notification_emails` (instant emails and
  digests). Refused requests are not counted.
- **Counting never slows a request.** The API keeps counts in memory and
  writes them in one `unnest` upsert every five seconds and at shutdown;
  a failed write is retried with the next batch. The usage endpoint flushes
  the serving instance first; other instances can be up to five seconds
  behind. A crash can lose those seconds of API counts, which is acceptable
  for reporting and would be revisited before usage-based charges. The
  worker counts deliveries and emails inside the transaction that marks
  them sent, so those are exact.
- **Who.** `usage.read` for owners and admins (session only). The page shows
  the size facts and the last six months.

## Not included

Plans, limits, invoices and a payment provider. Those need approval for a
hosted provider and pricing decisions; these counters are the input they
would use.

## Gates

`tests/integration/usage.test.ts`: size facts, API and SCIM requests counted
for the right organization (refused ones not), an email counted when sent,
members refused, other organizations isolated. The browser test audits the
page.
