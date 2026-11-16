# ADR-014: Append-only security audit log

Migration `20261116180000_m1_audit_events` adds `audit_events`, and
`AuditService` records account security events.

## Decisions

- **Append-only, enforced by the database.** Triggers reject `UPDATE`,
  `DELETE` and `TRUNCATE` with SQLSTATE 42501. Application bugs cannot
  rewrite history. Retention purges (docs/03) will need a dedicated,
  separately audited maintenance path that drops the trigger inside a reviewed
  migration or runs as a different database role.
- **No foreign keys.** Rows keep `actor_user_id`, `organization_id` and
  `target_id` as plain UUIDs so history outlives deleted users, sessions and
  organizations and never blocks their removal.
- **Same transaction as the change.** Transactional actions pass their client
  to `AuditService.record`, so the change and its record commit or roll back
  together. A failed audit insert fails the action.
- **Data minimization.** No passwords, tokens or email addresses. Client
  addresses are coarsened to IPv4 /24 or IPv6 /48 before storage; user agents
  are truncated to 256 characters. Metadata is a small object of scalars.
- **Failed logins.** Unknown emails are recorded with no actor or target and
  `reason: unknown_account`; known accounts are recorded with the account as
  target (not actor, since the caller is unauthenticated) and a reason such as
  `invalid_password` or `email_unverified`.
- **Closed set of action names.** `AuditAction` is a TypeScript union of
  dotted names and the database checks the format, so free-text actions cannot
  creep in.

## Events recorded

`auth.signup.created`, `auth.email.verified`, `auth.login.succeeded`,
`auth.login.failed`, `auth.logout`, `auth.password_reset.requested`,
`auth.password_reset.completed` (with `sessionsRevoked`),
`auth.session.revoked`, `auth.sessions.revoked_others` (with
`sessionsRevoked`). Organization, membership and invitation events are added
with those features.

## Not yet done

Request IDs to correlate events with logs, a viewer for organization owners,
retention policy and export.
