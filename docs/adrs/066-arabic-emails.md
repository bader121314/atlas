# ADR-066: Emails and push messages in each person's language (M10)

## Context

ADR-063 translated the web app but left everything the server sends in
English: verification, password reset, welcome and invitation emails,
notification emails, daily digests and push messages. Someone using Atlas in
Arabic would still get English email.

## Decisions

- **One catalog on the server.** `packages/shared/src/messages.ts` holds each
  message in English and Arabic under a key, with `{name}` placeholders, and
  `message(locale, key, vars)` fills them. The API and the worker both use it,
  so a message is written once.
- **The language lives on the account** in the existing `users.locale`
  column. It is recorded from the web app's `atlas_locale` cookie at sign-up
  and at every sign-in (password or SSO), and when a signed-in person
  switches language (`PUT /v1/auth/locale`, `en` or `ar` only). Anything else
  in the column reads as English.
- **Who decides for an invitation:** the invitee's language if they already
  have an account, otherwise the inviter's, since the inviter most likely
  shares a language with the person they invite.
- **What stays as typed:** task titles, names and organization names are
  data and are not translated; roles in invitations are.
- **The demo** gains a third project written in Arabic, so the right-to-left
  interface can be seen with real content, and the README shows it.

## Verification

Unit tests check that both languages have the same placeholders for every
message and that notification emails, digests and push titles follow the
recipient's language. Integration tests sign up with the Arabic cookie, check
the verification email's language, switch with the new endpoint and through
sign-in, and reject unknown languages and anonymous changes.

## Consequences

Adding a language means a column in the catalog and in the web app's
dictionary; the stored value already allows it. Arabic plurals are avoided
by wording ("{count} من الإشعارات") rather than handled by rules.
