# 05 — Authentication, Authorization, Threat Model and Security

## Security target

Use OWASP ASVS 5.0 as the requirements source; establish applicability matrix with verification evidence. Security claims require tests/reviews, not presence of a library. Threat-model first-party SPA/SSR, REST API, WebSocket, object uploads, workers, integrations, cloud infrastructure.

## Authentication design

- Server-side opaque random 256-bit session bearer; store only keyed hash in DB (e.g. HMAC-SHA256 with server secret) and rotate after login, privilege changes and MFA recovery events. HttpOnly, Secure, scoped cookie, SameSite=Lax or Strict as compatible with defined origin; explicit short idle/absolute expiry and server invalidation.
- Prefer one canonical first-party application origin with reverse proxy `/api` to simplify cookie and CSRF boundaries; distinct internal services. Ensure proxy header trust is configured narrowly.
- Register with email verification; rate-limit attempts by IP/account and use uniform recovery responses to discourage enumeration. Password hash Argon2id with tuned parameters, breached password checks where available, unique reset tokens hashed at rest and single use.
- WebAuthn/passkey support a roadmap item; implement TOTP MFA and recovery codes for owners/admins; step-up auth for owner transfer, member privilege elevation, API token creation, org deletion and sensitive exports.
- Account session inventory, revoke individual/all, sign-out across devices; permissions revalidate on every request.
- Login security logging without storing passwords/tokens, rate limits with progressive backoff and alerting.
- Cookie-based state changes protected via anti-CSRF token + exact Origin validation and SameSite; CORS restricted to authorized origins, never wildcard credentials.

## Authorization model

Two nested layers: org membership role + project/resource capabilities. Deny-by-default, permission calculations server-side, no trusting UI-hidden controls. Owner/admin/member/guest organization roles; project_manager/editor/commenter/viewer project roles. Organization owner only can transfer ownership/delete organization; admin may invite/manage non-owner members; manager may manage project scope; contributors only within project and action policy; guests have explicitly assigned project access only.

### Illustrative permission matrix

| Action                                                                                                               | Owner | Admin   | Member/project manager | Member/editor | Guest viewer           |
| -------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ---------------------- | ------------- | ---------------------- |
| Org security settings                                                                                                | yes   | limited | no                     | no            | no                     |
| Invite organization members                                                                                          | yes   | yes     | no                     | no            | no                     |
| Create project                                                                                                       | yes   | yes     | policy                 | no            | no                     |
| Edit project configuration                                                                                           | yes   | yes     | yes (assigned)         | no            | no                     |
| Read assigned project                                                                                                | yes   | yes     | yes                    | yes           | yes                    |
| Create/edit tasks                                                                                                    | yes   | yes     | yes                    | yes           | no                     |
| Comment                                                                                                              | yes   | yes     | yes                    | yes           | project commenter only |
| View org-wide audit log                                                                                              | yes   | limited | no                     | no            | no                     |
| Explicit project role overrides must never grant organization-owner privileges. Add machine-verifiable matrix tests. |

## Key threats and controls

- **Broken object-level authorization:** org-scoped repo queries, policy checks, compound FKs, cross-tenant E2E matrix, authorized search/export/WS tests.
- **XSS:** strict CSP with nonces where feasible, rich-text schema validation/sanitization, no untrusted HTML injection, safer markdown renderer, dependency review.
- **CSRF:** origin checks and CSRF tokens on cookie-authenticated writes, including WebSocket handshake.
- **Session theft/fixation:** Secure HttpOnly cookies, rotate and revoke, reauth on sensitive operations, anomaly detection.
- **SQL injection:** parameterized queries/ORM, restrict raw SQL to vetted modules, database least privilege.
- **SSRF via webhook URLs:** block private/loopback/link-local/metadata ranges and redirects to them, resolve/revalidate DNS at connect, outbound egress controls and restrictions.
- **File malware:** validated MIME/extension/size, asynchronous scanning, quarantine before accessible, signed upload/download, strict content-disposition, scan audit.
- **IDOR in downloads:** authorize each signed URL request, short expiry, immutable object keys; never expose bucket listing.
- **Replay/double execution:** idempotency keys and consumer receipt table, webhook timestamp signatures.
- **Privilege escalation:** server policy on every endpoint, audit grants, deny removal of last owner, test stale sessions.
- **Supply chain:** lockfiles, Dependabot/Renovate, SBOM, SCA, commit secret scanning and signed artifacts when possible.
- **Resource exhaustion:** upload and API quotas, pagination, job concurrency caps, expensive query timeouts and cost ceilings.
- **Cross-tenant cache disclosure:** no shared caching of private views; tenant+authorization-aware cache keys and tests.
- **Privacy leakage:** redact PII from logs; retention/export/deletion paths; access to analytics scoped by role.

## Security review release gates

- ASVS applicability/verification matrix checked, documented exceptions owned and tracked.
- Static scans/dependency checks with zero unresolved critical/high severity findings (or formally risk-accepted with expiry where legitimate).
- Dedicated authorization test suite across every object endpoint and WS room.
- Session, reset, invite, CSRF, OAuth/OIDC (if implemented), file upload and webhook abuse cases.
- Terraform policy checks, network boundaries, backups, least privileged IAM and secret rotation readiness.
- Threat model, incident playbook, vulnerability disclosure guidance, and recovery drill evidence.

## Privacy policy groundwork

Define data categories, purposes, retention per org, deletion request workflow, minimum PII storage, data export, account closure, and region selection. Legal compliance is jurisdiction-specific; do not claim regulatory certification without review.
