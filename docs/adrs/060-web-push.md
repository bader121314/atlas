# ADR-060: Browser push notifications (M9)

## Context

Notifications reach people in the inbox and by email (ADR-031, ADR-048).
The backlog lists mobile and PWA features; with the app installable
(ADR-053), a notification on the phone or desktop is the next step. Push
services (Google, Mozilla, Apple, Microsoft) are free and are reached by
the worker; Atlas runs no new service.

## Decisions

- **Standards, no SDK:** message encryption per RFC 8291 (`aes128gcm`,
  ECDH P-256, HKDF, AES-128-GCM) and VAPID per RFC 8292 (ES256 JWT), on
  `node:crypto` in `@atlas/shared`. Unit tests decrypt as a browser would and
  verify VAPID signatures.
- **Configuration:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (base64url
  P-256 keys) and `VAPID_SUBJECT`. Without them `/push/config` returns no
  key, the page says push is not set up, and the worker marks new
  notifications as not pushed.
- **Subscriptions** belong to a person (not an organization): session
  only, at most 10 per person, newest kept; an endpoint moves to whoever
  subscribed last on that browser. Endpoints must be https on a known push
  service host (`fcm.googleapis.com`, `updates.push.services.mozilla.com`,
  `web.push.apple.com`, `*.notify.windows.com`); the worker re-checks before
  sending, so a subscription cannot point the worker at internal addresses.
  `PUSH_ALLOWED_HOSTS` adds hosts outside production for tests.
- **Sending:** a worker loop (every second) takes pending notifications
  with `SKIP LOCKED`, skips read ones, and sends to each subscription with a
  one-day TTL. 404 and 410 delete the subscription; other failures count,
  and ten in a row delete it. The message holds who did what, the task title
  and a link; comment text is never included. Notifications created before
  this change are never pushed.
- **Browser:** the service worker shows the notification and opens only
  same-origin links on click. The notifications page has a per-device
  switch; turning it off unsubscribes on both sides.

## Gates

`tests/web-push.test.ts` (encryption round trip, VAPID verification, host
rules) and `tests/integration/web-push.test.ts` (subscription rules, a
delivered message decrypted with the browser's keys, a gone subscription
removed, no double sends, skipped after unsubscribing).
