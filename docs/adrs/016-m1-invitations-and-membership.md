# ADR-016: Invitations, role changes and removal

## Decisions

- **Two authorization layers.** `TenantGuard` checks the route permission
  (`members.invite`, `members.manage`), then `MembershipsService` applies
  role rules from `organizations/policy.ts`:
  - Owners may invite, promote, demote and remove anyone, including other
    owners.
  - Admins may invite, change and remove only members and guests, and may
    only grant member or guest. They cannot create admins or owners or act
    on them, so an admin can never escalate their own or anyone's privileges.
  - Any member may leave (remove themselves).
- **Invitations are bound to an email.** Accepting requires a signed-in,
  verified account with the invited email. Unknown, used, revoked, replaced,
  expired or someone else's invitations all return the same 400. Tokens are
  stored as HMAC digests, last 7 days, and inviting the same email again
  revokes the previous invitation (one outstanding per email, ADR-010).
- **Invitations never grant ownership** (schema and database both reject it).
  Ownership transfer is "promote the successor to owner, then demote
  yourself"; the deferred last-owner trigger (ADR-010) guarantees an owner
  remains, and violations return 409.
- **Removal is a state change.** Members are set to `removed`, which ends
  access on the next request because `TenantGuard` requires `active`. The row
  stays for history and the inviter foreign key; a removed member can rejoin
  through a new invitation. Suspended members are not reinstated by an
  invitation.
- **Accepting is not tenant-scoped.** `POST /v1/invitations/accept` derives
  the organization from the token, so invitees never need to know an
  organization id.
- **Everything is audited** in the same transaction: invitation created and
  revoked, member joined, role changed (from and to), removed and left. Audit
  metadata stores roles, never invited email addresses.
- **Limits.** 50 invitations per account per hour; 30 accept attempts per
  address per 15 minutes.

## Not yet done

Resending an invitation email without reissuing, suspending and unsuspending
members, owner-only step-up authentication for ownership transfer (docs/05),
and notifying members when their role changes.
