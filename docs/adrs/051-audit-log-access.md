# ADR-051: Organization audit log access and export (M9)

## Context

Audit events have been recorded since M1 (ADR-014) but could only be read
in the database. Enterprise customers expect administrators to review and
export them.

## Decisions

- **Who.** A new organization action, `audit.read`, for owners and admins.
  It is session-only: API tokens are limited to `organization.read` routes
  (ADR-037), so a leaked token cannot read the log.
- **What.** Events whose `organization_id` is this organization: membership,
  invitations, projects, API tokens, public links and audit exports. Account
  events (sign-ins, password changes) have no organization and stay private
  to the person. Networks remain the summarized /24 or /48 (ADR-014).
- **Reading.** Newest first, 1 to 100 per page, keyset paging on
  (`occurred_at`, `id`) with the cursor resolved inside the organization, so
  a cursor from elsewhere returns nothing. Filtering is by exact action or
  dotted prefix (`org.member` matches `org.member.joined`).
- **Export.** CSV of whole UTC days, at most 366 days and 100,000 rows
  (`X-Atlas-Truncated` when cut). Built synchronously because the range and
  row cap bound it; cells use the shared formula-injection protection now
  in `@atlas/shared` (also used by task exports, ADR-035). Every export is
  itself audited as `org.audit.exported` with its range and row count.

## Threat model and gates

- Members, guests and other organizations are refused (403 or 404); paging
  cannot cross organizations (`tests/integration/audit-log-view.test.ts`).
- The log never stores tokens, passwords or email addresses (ADR-014), so
  exporting it does not expose them.
- Retention is unchanged: events are kept until a retention policy is
  decided (open item).
