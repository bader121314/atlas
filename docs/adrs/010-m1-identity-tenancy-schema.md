# ADR-010: M1 identity and organization tenancy schema

Migration `20261116120000_m1_identity_organizations` adds `users`, `sessions`,
`verification_tokens`, `organizations`, `organization_memberships` and
`invitations`. The SQL migration is authoritative; `schema.prisma` mirrors the
tables and keys, but CHECK constraints, the partial unique index and triggers
exist only in SQL.

## Decisions

- **Ownership lives in memberships only.** `docs/03` originally listed
  `organizations.owner_user_id`. A second owner pointer could disagree with
  membership roles, so organizations record `created_by_user_id` and owners are
  memberships with `role = 'owner'`. Multiple owners are allowed.
- **Active-owner invariant in the database.** Deferred constraint triggers on
  `organizations` and `organization_memberships` reject, at COMMIT, any live
  organization without an active owner. This covers creation without an owner
  and deleting, demoting or suspending the last owner, while still allowing an
  ownership transfer inside one transaction. Organizations with
  `status = 'deleted'` are exempt so staged deletion can proceed.
- **Composite tenant key.** `invitations (organization_id, invited_by_user_id)`
  references `organization_memberships (organization_id, user_id)`, so an
  inviter must belong to the same organization. Later tenant tables follow the
  same `(organization_id, ...)` composite pattern.
- **Immutable tenant keys.** Triggers reject changes to `organization_id` on
  memberships and invitations.
- **Invitations never grant ownership.** Role is limited to admin/member/guest;
  ownership changes are explicit transfers. One outstanding invitation per
  organization and email (partial unique index); the application revokes an
  expired invitation before reissuing.
- **Tokens stored as digests.** Session, verification and invitation tokens are
  stored only as 32-byte HMAC-SHA256 digests (enforced by CHECK). Raw tokens
  never reach the database.
- **TEXT + CHECK instead of PostgreSQL enums** so new roles or states are an
  expand-only migration.

## Verification

`tests/integration/identity-tenancy.test.ts` exercises every rule above against
a freshly migrated PostgreSQL database in CI, including the negative cases.
Application-level policy (deny-by-default membership checks, sessions, CSRF)
is still required and arrives in the following M1 changes; database
constraints are defense in depth, not a substitute.
