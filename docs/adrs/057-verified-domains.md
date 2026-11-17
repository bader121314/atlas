# ADR-057: Verified email domains (M9)

## Context

SCIM provisioning (ADR-055) could add any address, and single sign-on needs
to know which organization's identity provider is responsible for an email
address. Both need proof that an organization controls a domain.

## Decisions

- **Proof by DNS.** An owner adds a domain and receives a TXT record:
  `_atlas-challenge.<domain>` with value `atlas-domain-verification=<token>`
  (24 random bytes). Verify looks the record up; it must match exactly.
  The lookup sits behind a `DomainResolver` provider so tests replace DNS.
- **One holder.** A partial unique index allows a domain to be verified by
  one organization at a time; others can list it but verifying returns 409.
  Removing a domain releases it.
- **Owners only** (`domains.manage`), at most 10 domains, all changes
  audited (`org.domain.added`, `org.domain.verified`, `org.domain.removed`).
- **Provisioning.** Once an organization has a verified domain, SCIM only
  provisions addresses on its verified domains (400 `invalidValue`
  otherwise). This closes the open item in ADR-055.
- **Not rechecked.** A verified domain stays verified; periodic re-checks
  (and expiry when the record disappears) are a follow-up.

## Gates

`tests/integration/domains.test.ts`: normalization and validation,
duplicate refusal, failed then successful verification, a rival
organization unable to verify or delete, provisioning limited to the
domain, owner-only management.
