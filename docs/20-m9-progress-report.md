# 20 — M9 Progress Report: First Expansion Batch

**Status:** first batch complete; M9 stays open as the expansion backlog.
**Date:** 2026-11-17.
**Scope reference:** `docs/08-milestones.md`, M9. Each item below shipped
with an ADR, a data and threat model and acceptance gates, as M9 requires.

## Delivered

| Item                                 | ADR | PR  | Acceptance gates (tests)                                                                                                                         |
| ------------------------------------ | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Multiple assignees (M2 carry-over)   | 046 | #53 | Primary assignee kept in step by a trigger for every writer; assignees must be able to open the project (`assignees`)                            |
| Team workload view                   | 047 | #54 | Open work per person and week counted only in projects the viewer can read; guests refused (`workload`)                                          |
| Notification preferences and digests | 048 | #55 | Muted kinds create nothing; daily mode sends nothing instantly, one digest, and no second one within 24 hours (`notifications`)                  |
| Time tracking                        | 049 | #56 | Viewers cannot log, editors cannot remove others' entries, reports exclude other people (unless admin) and unreadable projects (`time-tracking`) |
| Public read-only share links         | 050 | #57 | Payload has no descriptions, people or comments; expiry, revocation, archiving and the creator losing manager rights end access (`share-links`)  |

**Test totals:** 205 unit tests and 143 integration tests, plus the browser
test (which now logs time and opens a public link signed out), image
builds, Terraform validation and the release drill.

## Data and contract changes

Migrations `m9_task_assignees`, `m9_notification_preferences` (replaces the
email on/off flag with a mode; existing "off" settings carry over),
`m9_time_entries` and `m9_share_links`. All new tables use composite tenant
foreign keys and the immutable-tenant-key trigger. The OpenAPI contract and
`@atlas/contracts` schemas cover every new route; the settings API still
returns `email` for older clients.

## Risks and limits

- Share links are the first unauthenticated data route. The payload is
  built from its own query and schema so new task fields cannot leak by
  default; the security review lists it.
- Digests run hourly in the worker; with several workers, `SKIP LOCKED`
  prevents duplicates, but digest timing drifts by up to an hour.
- Time totals are not yet in exports or webhooks.

## Remaining M9 candidates

Fine-grained ABAC, richer Gantt and capacity planning, SSO/SAML, SCIM,
enterprise audit exports, multi-region recovery, a search index service,
billing and metering, and mobile/PWA features. Hosted items still need
approval for running costs (AGENTS.md).
