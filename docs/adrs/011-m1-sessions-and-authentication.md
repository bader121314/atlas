# ADR-011: Sessions, password storage and request-origin checks

Implements the first M1 authentication slice from `docs/05-security.md`:
signup, email verification, login, logout and the current-session endpoint.

## Decisions

- **Argon2id from Node's standard library.** Node 24.7+ ships
  `crypto.argon2`, so no native addon is needed. Parameters follow the OWASP
  Password Storage Cheat Sheet baseline (m=19456 KiB, t=2, p=1, 32-byte tag)
  and are stored in PHC format, so they can be raised later and old hashes
  still verify.
- **Opaque server-side sessions.** Tokens are 256 random bits sent in an
  HttpOnly, SameSite=Lax cookie (`__Host-` prefix and Secure in production).
  The database stores only an HMAC-SHA256 digest keyed with `SESSION_SECRET`,
  so a database leak alone does not yield usable sessions. Sessions expire
  after 7 days; logout revokes server-side. `last_seen_at` is written at most
  every 5 minutes.
- **CSRF defense: exact Origin check plus SameSite.** A global guard rejects
  any non-GET/HEAD/OPTIONS request whose Origin header is not exactly
  `WEB_ORIGIN`, including requests with no Origin. `docs/05` also calls for an
  anti-CSRF token; that is still planned and will be added with the web forms.
- **Enumeration resistance.** Signup returns the same 202 and empty body for
  new and existing emails and sends no email for existing ones. Login returns
  the same 401 for unknown email, wrong password, unverified and disabled
  accounts, and runs a decoy Argon2 verification for unknown emails so timing
  is similar.
- **Verified email required to sign in.** Verification tokens are single use,
  expire after 24 hours and are stored as digests.
- **Plain parameterized SQL for repositories.** The generated Prisma 7 client
  needs a driver adapter that is not yet a dependency, and these queries rely
  on PostgreSQL features (`ON CONFLICT`, conditional updates). Repositories use
  `pg` with parameters only; Prisma remains the schema and migration tool.
  Revisit when domain modules grow.
- **Development mail transport only.** Until the outbox email worker (M4),
  verification emails are printed to the API console in development. The
  transport refuses to send when `NODE_ENV=production`.
- **Auth settings validated separately.** `SESSION_SECRET` (min 32 chars) and
  `WEB_ORIGIN` are checked at API startup and on first use, so the worker and
  health checks do not need them. Error messages name fields only.

## Not yet done

Rate limiting and lockout, resend-verification, password reset, session list
and revoke-all, anti-CSRF token, breached-password check, audit events for
security-relevant actions. Tracked in `implementation/SESSION_HANDOFF.md`.
