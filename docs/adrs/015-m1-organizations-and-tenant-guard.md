# ADR-015: Organizations, tenant resolution and the policy matrix

## Decisions

- **The URL selects the organization.** Tenant routes live under
  `/v1/organizations/{slug}`. There is no server-side "current organization",
  so "switching" is navigating to another slug and nothing can fall out of
  sync between tabs or devices.
- **One guard resolves every tenant request.** `TenantGuard` runs after
  `SessionGuard`, validates the slug, and loads the caller's **active**
  membership in an **active** organization in a single query. The result
  (`organizationId`, `role`) is attached to the request; services use only
  that id and never accept organization ids from bodies or query strings.
  Strict request schemas reject unknown fields such as `organizationId`.
- **404 for outsiders, 403 for insiders.** Unknown slugs, other tenants'
  organizations and suspended memberships all return the same 404, so
  organization names cannot be probed. Members who lack a permission get 403,
  since they already know the organization exists.
- **Deny by default.** Each tenant route declares one policy action with
  `@RequirePermission`. A route without one is rejected by the guard. Grants
  live in one table (`organizations/policy.ts`) and a unit test pins the full
  role-by-action matrix, so any grant change shows up in review.
- **Creation is atomic.** The organization, the creator's owner membership
  and the `org.created` audit event commit in one transaction; the ADR-010
  trigger guarantees the owner exists at commit.
- **Slug conflicts return 409.** This reveals that a slug is taken, which is
  accepted: slugs appear in URLs and are not secret. Organization creation is
  limited to 10 per account per hour.

## Current matrix

| Action              | Owner | Admin | Member | Guest |
| ------------------- | ----- | ----- | ------ | ----- |
| organization.read   | yes   | yes   | yes    | yes   |
| organization.update | yes   | yes   | no     | no    |
| members.read        | yes   | yes   | yes    | no    |

Invitations, role changes, removal and ownership transfer add actions in the
next change. Project roles (M2) refine access within an organization and may
never grant owner-only actions.
