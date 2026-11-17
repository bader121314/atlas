# ADR-048: Notification preferences and daily digests (M9)

## Decisions

- **Per organization, per person:** mute any notification kind
  (assignment, mention, comment) and choose how email arrives: each
  notification (after the two-minute delay, ADR-031), one daily summary, or
  none. Settings replace the earlier on/off email flag; the API still
  returns `email` for older clients.
- **Muting applies at creation.** The notifier never creates a muted kind
  for that person, so muted items do not appear in the inbox, the unread
  count or email. A mention is still delivered if only comments are muted.
- **Digests** go out at most once per 24 hours per person and organization,
  listing unread notifications (up to 20) that have not been emailed; those
  are then marked sent. Notifications read before the digest are skipped,
  as with instant email. The digest job claims settings rows with `SKIP
LOCKED`, so several workers never send the same digest twice.

## Threat model and gates

- Digests contain task keys and titles the person can already read; access
  was checked when each notification was created (ADR-031), and comment
  bodies are never included.
- Preferences only change what the caller receives; validation refuses
  unknown kinds (`tests/integration/notifications.test.ts`).
- Gates: muted kinds create nothing; daily mode sends nothing instantly,
  one digest, and no second digest within 24 hours.
