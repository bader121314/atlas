# ADR-050: Public read-only share links (M9)

## Context

Teams want to show progress to people outside the organization (a client,
a partner) without inviting them. Anything reachable without signing in is
the largest exposure Atlas has, so the scope is deliberately narrow.

## Decisions

- **What is shown.** A project's key and name and, for up to 500 tasks:
  number, title, status name and category, priority and due date. Never
  descriptions, people (assignees, authors, ids), comments, attachments,
  custom fields, labels, milestones, time or activity. The public response
  is built from its own query and schema (`sharedProjectSchema`), not by
  filtering a task response, so new task fields cannot leak by default.
- **Tokens.** `ats_` plus 32 random bytes. Only an HMAC digest is stored
  (as for API tokens, ADR-037); the link is shown once. Managers see a short
  prefix, creator, expiry and last use.
- **Who and how long.** Project managers create and revoke links
  (`project.update`, never available to API tokens). Links expire after 1
  to 90 days (default 30); at most 10 live links per project.
- **When a link stops working.** Expiry, revocation, the project being
  archived or deleted, or the creator no longer managing the project
  (leaving the organization, losing the manager role). This is checked on
  every view, so access never outlives the authority that granted it.
- **Uniform failure.** Unknown, malformed, expired and revoked tokens all
  return the same 404.
- **Not leaking the token.** API and web responses send
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and
  `X-Robots-Tag: noindex`; request logs replace the token with `:token`.
- **Abuse.** Views are rate limited per IP (120 a minute); a 256-bit token
  makes guessing infeasible regardless. `last_used_at` is written at most
  once a minute so popular links do not turn reads into writes.
- **Audit.** `share_link.created` and `share_link.revoked` are recorded.

## Threat model and gates

- Data fence: the public payload contains no description, comment text or
  user id (`tests/integration/share-links.test.ts`).
- Lifecycle: demoting the creator, revoking and archiving each make the
  link return 404; restoring the creator's role restores it.
- Tenancy: another organization cannot list or revoke links, even through a
  project with the same key; editors cannot create links; the per-project
  cap and expiry bounds are enforced.
- Logged paths never contain the token (`tests/request-context.test.ts`).
