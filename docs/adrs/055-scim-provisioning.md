# ADR-055: SCIM 2.0 user provisioning (M9)

## Context

Enterprise customers manage people in an identity provider (Okta, Microsoft
Entra ID, Google) and expect access to follow: joiners get accounts,
leavers lose access the same day. The backlog lists SCIM. It needs no hosted
service from Atlas; the customer's provider calls us.

## Decisions

- **Scope: Users of one organization.** `/v1/scim/v2` serves
  `ServiceProviderConfig`, `ResourceTypes` and `Users` (list with
  `userName eq` / `externalId eq` filters and paging, get, create, PUT,
  PATCH, DELETE). Groups, bulk, sorting and ETags are not offered and the
  configuration says so. Bodies use `application/scim+json` (a small parser
  for that type; 100 KB limit) and errors use the SCIM error schema.
- **Authentication.** A bearer token (`atlscim_` plus 32 random bytes)
  created by an organization **owner**, stored as an HMAC digest and shown
  once; at most two live tokens, so they can be rotated. The token is the
  tenant: no session, API token or browser-supplied id selects the
  organization. 600 requests a minute per token.
- **What provisioning may change: membership only.** Create adds the person
  as a `member` (a new account is created verified, since the provider
  vouches for the address, with a welcome email to choose a password within
  7 days; an existing account is added without changes). `active=false`
  suspends the membership, `active=true` restores it, DELETE removes it;
  access ends on the next request because every tenant route checks the
  membership. `externalId` is stored per organization. Names, emails and
  passwords belong to the account, which can be in several organizations, so
  the directory never changes them; such attributes are accepted and
  ignored.
- **Owners and admins are out of reach.** Suspending or removing them returns
  403 (`mutability`); privileged roles stay managed inside Atlas.
- **Audit.** `org.member.provisioned`, `org.member.deprovisioned`,
  `org.member.reactivated` (with `via: scim`) and token creation and
  revocation.

## Risks and follow-up

- Without domain verification, an owner's directory can add any address,
  as invitations can. The person can leave at any time, and new accounts
  cannot be used until the owner of the address sets a password. Once an
  organization verifies a domain, provisioning is limited to it (ADR-057).
- Groups (mapping directory groups to projects or roles) are not supported.

## Gates

`tests/integration/scim.test.ts`: provisioning a new person through to
sign-in, filters, conflicts, suspension ending access, ignored profile
changes, removal, audit entries, protected owners and admins, cross-tenant
404s, revoked and missing tokens, sessions refused, owner-only token
management and the two-token cap.
