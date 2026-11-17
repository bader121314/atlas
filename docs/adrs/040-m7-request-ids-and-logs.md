# ADR-040: Request ids, structured logs and trusted proxies

## Decisions

- **Every request has an id.** A middleware takes `X-Request-Id` from the
  caller when it looks like an id (8–128 letters, digits, `.`, `_`, `-`),
  so a load balancer's id carries through, and otherwise generates a UUID.
  The id is returned in `X-Request-Id`, in every problem-details error body
  and stored on audit events, so a support report, a log line and an audit
  record can be joined.
- **One JSON log line per request.** Time, level, request id, method, path
  without its query string, status, duration and user id. Query strings,
  headers and bodies are never logged, so tokens and personal data stay out
  of logs. Tests switch the line off.
- **Client addresses from trusted proxies only.** `TRUST_PROXY` sets
  Express's `trust proxy`: unset trusts nothing (the socket address is the
  client, as before), a number trusts that many hops, `loopback` trusts a
  proxy on the same host such as the web server. Rate limits and audit IP
  summaries then use the real client address instead of the proxy's.
