# ADR-045: Mentions

## Decisions

- **Mentions are explicit ids, not parsed names.** A new comment may carry
  `mentions: [userId]` (up to 20). The web composer offers a "Mention
  someone" list that inserts `@Display Name` into the text and sends the ids
  of everyone named that way. Parsing free text for names would be
  ambiguous (two people with the same name, names with spaces).
- **Only people who can open the project.** The API rejects a comment that
  mentions someone without access to the project (400), so a mention cannot
  reveal a private project's task to an outsider through a notification.
- **One notification per person per event.** Mentions are planned before
  the usual comment recipients; the existing unique (recipient, event) key
  means someone both mentioned and following the task receives the
  mention only. Mention ids travel in the outbox payload, not in history.
