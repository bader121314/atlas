# ADR-037: Scoped API tokens

## Decisions

- **Personal, per organization, scoped.** A member creates a token for one
  organization with `tasks:read` and optionally `tasks:write`, expiring in
  7 to 365 days (default 90). It acts as that person: it can never do more
  than they can, and less whenever the scope or the rules below say so.
  Guests cannot create tokens.
- **Stored like sessions.** `atl_` plus 32 random bytes, shown once; only
  an HMAC-SHA256 digest is kept, with a short prefix for recognition.
  Tokens stop working when revoked, expired, or when the person's
  membership or account ends. Creation and revocation are audited.
- **Only on task routes.** A bearer token is accepted only on routes that
  declare an organization permission (tenant routes); account, session and
  organization-list routes answer 401. Within a tenant, a token may only
  perform `organization.read`-level actions (so no members, settings,
  projects or webhooks), only in its own organization (another answers
  404), and project actions need the matching scope: reads need
  `tasks:read`, task changes and comments need `tasks:write`; project
  settings, membership and exports are never available to tokens. Token
  management itself requires a signed-in browser.
- **No Origin check for bearer requests.** Browsers never attach an
  Authorization header on their own, so cross-site request forgery does
  not apply; cookie-authenticated writes keep the exact-Origin rule.
- Organization-level reads such as search and notifications work with any
  token of that person, since they show only what the person can see.
