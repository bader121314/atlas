# ADR-031: In-app notifications and email

## Decisions

- **Notifications come from the outbox.** A notifier loop in the worker
  claims outbox events not yet handled (`notified_at IS NULL`, `FOR UPDATE
SKIP LOCKED`), inserts notifications and marks the events in one
  transaction, so each event notifies exactly once. A unique
  `(recipient, source event)` key makes any retry harmless. It is
  independent of Redis: notifications are not lost when pub/sub is down.
- **Who is notified.** Assignment (at creation or later) notifies the new
  assignee; a comment notifies the task's reporter, its assignee and
  everyone who has commented. Nobody is notified of their own action.
  Mentions and watchers are later work.
- **Access is checked twice.** Recipients must be able to read the project
  when the notification is created, and the inbox only lists notifications
  for projects the caller can read now, so a project turned private stops
  showing its notifications to people outside it.
- **No content copies.** A notification stores ids and a kind; titles and
  names are joined when read. Comment bodies never appear in notifications
  or emails.
- **Email waits two minutes.** The email loop sends notifications that are
  still unread after `NOTIFICATION_EMAIL_DELAY_MS` (default two minutes), so
  someone already in Atlas is not emailed too. People can turn email off per
  organization; those and already-read notifications are marked `skipped`.
  A failed send stays `pending` and is retried. Development prints emails
  to the worker log; production refuses to send until a transport exists.
- Published outbox rows are only pruned after the notifier has handled them.
