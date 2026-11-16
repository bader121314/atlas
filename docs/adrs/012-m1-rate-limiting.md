# ADR-012: Rate limiting for authentication routes

## Decisions

- **Redis fixed-window counters.** One Lua script does `INCR` and sets the
  window expiry atomically, so concurrent API instances share one count.
  Fixed windows allow a short burst at window edges; that is acceptable for
  these limits and far simpler than sliding windows.
- **Limits per address and per account.**

  | Route               | Per address | Per account (email) |
  | ------------------- | ----------- | ------------------- |
  | login               | 30 / 15 min | 10 / 15 min         |
  | signup              | 10 / hour   | —                   |
  | verify-email        | 30 / 15 min | —                   |
  | resend-verification | 10 / hour   | 3 / hour            |

  The per-account login limit stops guessing one password from many
  addresses; the per-address limit stops one address trying many accounts.
  Every attempt counts, not only failures, which keeps the logic simple and
  still allows normal use.

- **429 with `Retry-After`.** Responses use the standard problem body and a
  `Retry-After` header in seconds.
- **Fail closed.** If Redis is unreachable or slow (2 s), rate-limited routes
  return 503 instead of skipping the check. Brute-force protection must not
  disappear during an outage. Other routes are unaffected.
- **No raw identities in Redis.** Keys contain a SHA-256 of the email or
  address, never the value itself.
- **Socket address only.** The client address is the TCP peer. Proxy headers
  such as `X-Forwarded-For` are ignored until a trusted proxy is configured in
  M7; trusting them earlier would let clients choose their own address.
- **Resend verification.** Issues a new link, invalidates earlier unused ones,
  and responds 202 with an empty body for unknown and already verified emails,
  matching signup.

## Not covered yet

Lockout notifications, CAPTCHA or proof-of-work after repeated failures, and
alerting on limit spikes. Revisit with observability in M7.
