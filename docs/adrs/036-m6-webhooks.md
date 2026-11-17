# ADR-036: Outbound webhooks

## Decisions

- **Planned from the outbox, exactly once.** A planner loop in the worker
  claims outbox events not yet handled (`webhooks_at IS NULL`), creates one
  delivery per subscribed, active endpoint and marks the events, all in one
  transaction; `(endpoint, event)` is unique. The payload is a snapshot of
  the task (key, title, state, priority, version) taken at planning time.
- **Signed like the common providers.** Each request carries
  `X-Atlas-Event-Id`, `X-Atlas-Event-Type`, `X-Atlas-Timestamp` and
  `X-Atlas-Signature: v1=HMAC-SHA256(secret, "{timestamp}.{body}")`.
  Receivers verify in constant time, reject timestamps older than five
  minutes, and drop event ids they have processed: delivery is at least
  once, and a replay sends the same event id again.
- **Secrets are sealed.** The `whsec_` secret is shown once at creation and
  stored encrypted with AES-256-GCM under `WEBHOOK_SECRET_KEY`; without
  that key webhook writes answer 503.
- **SSRF protection in two places.** Saving requires https (http only in
  development), no credentials in the URL, and refuses private literal
  addresses and `localhost`/`.internal` names. Sending resolves the host
  and connects only if every address is publicly routable (private,
  loopback, link-local and cloud metadata, carrier-grade NAT, multicast,
  reserved, IPv6 ULA and mapped forms are refused); the connection uses the
  checked address, so DNS rebinding cannot swap it. Redirects are never
  followed, responses are not read, and requests time out after five
  seconds. Tests exercise both refusals with `localhost` and a literal
  loopback address.
- **Retries and pausing.** Failures retry with backoff (10 s doubling to an
  hour) up to eight attempts. Fifteen failed attempts in a row pause the
  endpoint; resuming it resets the count. Every attempt's result is kept
  and shown as delivery history, with "send again" and a test ping.
- **Who:** organization owners and admins (`webhooks.manage`), who can
  already see every project, so organization-wide events do not widen what
  they can learn.
- `WEBHOOK_ALLOW_HTTP` and `WEBHOOK_ALLOWED_HOSTS` exist for local
  development and tests and are ignored in production.
