# ADR-017: Web application for accounts and organizations

## Decisions

- **One browser origin.** The browser talks only to the web app. Next.js
  rewrites `/api/*` to the API's `/v1/*` (`API_ORIGIN`, default
  `http://127.0.0.1:3001`). Cookies stay first-party, the API's exact Origin
  check (ADR-011) works unchanged, and no CORS configuration exists to get
  wrong. This is the single-origin setup `docs/05` prefers; production puts
  the same split behind a load balancer.
- **Client components calling the API.** Pages fetch through one helper,
  `lib/api.ts`. It only exposes response bodies for 2xx responses: error
  responses carry a problem body, and treating that as data once made a
  signed-out visitor look signed in (caught by the browser smoke test).
- **The UI never decides access.** It hides controls the caller cannot use,
  mirroring ADR-016 rules, but every action is enforced by the API.
- **State changes need a click.** Email verification, password reset and
  invitation links open a page with a button instead of acting on page load,
  because mail scanners open links automatically.
- **Safe redirects.** After sign-in, only same-site relative `next` paths are
  followed, so the login page cannot be used as an open redirect. The
  redirect keeps the query string, so invitation links survive signing in.
- **Plain CSS, no UI framework yet.** `docs/02` lists Tailwind and shadcn/ui;
  they were not added because this change could not update the lockfile. The
  survey-map visual identity lives in `app/globals.css` (palette, serif
  headings, contour artwork on sign-in pages). Revisit with the M3 design
  system.
- **CSRF.** Writes are protected by the exact-Origin check, SameSite=Lax
  cookies, same-origin requests and JSON bodies (which cross-site forms cannot
  send without a preflight). A separate anti-CSRF token is deferred; it adds
  little on top of these and will be reconsidered with the M3 design system.
- **Browser smoke test in CI.** `.github/workflows/ui-smoke.yml` builds and
  starts the API and web app against real PostgreSQL and Redis, installs
  Playwright for that job only, and drives three users through signup,
  verification, organization creation, invitation and acceptance, plus an
  outsider getting "not found". Screenshots are uploaded as an artifact.

## Known limitations

- Through the proxy, the API sees every request coming from the web server's
  address, so per-address rate limits are shared by all users in this setup.
  A trusted-proxy configuration (forwarded client address from a known proxy
  only) is required before production; tracked for M7.
- The invitation page cannot show the organization's name before accepting,
  because no endpoint reveals invitation details by token yet.
