# ADR-064: Per-request nonces in the content security policy (M10)

## Context

The policy allowed `'unsafe-inline'` scripts because Next.js hydrates with
inline scripts. That left one of the main XSS defences open: if markup were
ever injected, an inline `<script>` would run. The security review listed it
as open item 1.

## Decisions

- **A nonce per response.** `apps/web/proxy.ts` runs before every page,
  makes 128 random bits with Web Crypto, and builds the policy in
  `lib/csp.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'`. The policy is
  set on the response and on the forwarded request, where Next.js reads the
  nonce and stamps it on its own scripts. `'strict-dynamic'` lets those
  scripts load the page's chunks without listing every file.
- **Pages only.** The proxy skips `/api`, build output, icons, the service
  worker, the manifest and the offline page, which have no inline scripts.
  Router prefetches are skipped too, so a prefetched page never carries a
  nonce that differs from the one its scripts were given.
- **Every page renders per request.** The root layout already reads the
  language cookie, so no page was statically cached; a nonce would rule
  that out anyway.
- **Styles keep `'unsafe-inline'`.** React writes `style` attributes (bar
  widths, timeline positions); CSS cannot run scripts. Revisit if styles
  move fully to classes.
- **Development** adds `'unsafe-eval'` for fast refresh, never in production.
- **Runtime, not build time.** The storage origin for direct uploads is now
  read when the request is served, so one image works for any storage host.

## Verification

Unit tests pin the policy and the nonce's size and randomness. The browser
test checks that the login page's policy has a nonce and no
`'unsafe-inline'`, that the nonce changes between responses, that the
page's scripts carry it, and fails if any page logs a policy violation
during the full walkthrough.

## Consequences

Each page response costs one random value and a header; no caching was
lost. An injected inline script no longer runs, closing the main remaining
XSS gap.
