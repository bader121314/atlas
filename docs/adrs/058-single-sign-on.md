# ADR-058: Single sign-on with OpenID Connect (M9)

## Context

With verified domains (ADR-057) and provisioning (ADR-055), the remaining
enterprise expectation is signing in through the company's identity
provider instead of an Atlas password. Customers bring their own provider,
so there is no hosted cost.

## Decisions

- **Protocol: OpenID Connect**, authorization code flow with PKCE (S256),
  `state` and `nonce`. SAML is not offered; the major providers (Entra ID,
  Okta, Google) all speak OIDC. Endpoints come from the issuer's discovery
  document, which must name the configured issuer.
- **Settings per organization** (owners): issuer, client ID, client secret
  (sealed with AES-256-GCM under `SSO_SECRET_KEY`, never returned), enabled,
  and "require SSO". Enabling needs a verified domain. Settings are
  validated by fetching discovery before saving. The redirect URL is
  `WEB_ORIGIN/api/auth/sso/callback`.
- **Routing by domain.** The sign-in page asks for a work email; its domain
  selects the organization that verified it. Unknown domains return to the
  page with "not set up" (this reveals only that SSO is configured for a
  domain, which is visible in the provider redirect anyway).
- **Callback checks.** The state is single use (deleted on first return)
  and expires after 10 minutes. The ID token must be RS256 or ES256 signed
  by a key from the provider's JWKS, with the right issuer, audience,
  nonce and expiry (one minute of skew). An address the provider marks
  unverified is refused; the address must be on one of the organization's
  verified domains whatever the provider says.
- **Accounts.** The account with that email is used (created verified if
  new, with no password). People not in the organization join as members;
  suspended members are refused. Sessions are ordinary Atlas sessions;
  `auth.login.succeeded` records `method: sso`, failures are audited as
  `auth.sso.failed` with a reason.
- **Require SSO.** Password sign-in for addresses on the organization's
  verified domains returns 403 (only after a correct password, so it does
  not reveal anything to guessers). Owners are exempt so a broken provider
  cannot lock the organization out.
  Turning the requirement on ends every existing session of people with
  addresses on the verified domains (owners again exempt), so password
  sessions do not outlive it; they sign in again through the provider.
- **Outbound requests** to the provider follow the webhook rules (ADR-036):
  https, public addresses, no redirects, timeouts and size caps.
  `SSO_ALLOW_HTTP` and `SSO_ALLOWED_HOSTS` relax them outside production
  for local providers and tests. Addresses are checked before connecting
  rather than pinned, a small gap compared with webhooks, acceptable because
  only owners set the issuer.

## Not included

SAML, provider-initiated sign-in, single logout and group-to-role
mapping.

## Gates

`tests/integration/sso.test.ts` with a local provider: sign-in creating the
account and membership, single-use state, tampered signatures, wrong nonce,
unverified and foreign addresses, unclaimed domains, require-SSO with the
owner exemption and the generic wrong-password response, owner-only
settings, tenancy, and the verified-domain precondition. The browser test
covers the unclaimed-domain path.
