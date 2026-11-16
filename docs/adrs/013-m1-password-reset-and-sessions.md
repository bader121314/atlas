# ADR-013: Password reset and session management

## Decisions

- **Reset links only for verified, active accounts.** Unknown and unverified
  emails get the same 202 and empty body but no email; unverified accounts use
  resend-verification instead. Requesting a new link invalidates earlier
  unused ones. Links are single use, expire after 1 hour and are stored as
  HMAC digests like every other token.
- **Reset signs out everywhere.** Consuming the token, writing the new
  Argon2id hash and revoking every session for the user happen in one
  transaction, so a stolen session cannot survive a reset.
- **Validate before consuming.** The new password is validated before the
  token is used, so a rejected password does not burn the link.
- **Users manage only their own sessions.** `GET /auth/sessions` lists active
  sessions with the current one marked; `DELETE /auth/sessions/{id}` and
  `POST /auth/sessions/revoke-others` revoke by `id AND user_id`. Another
  user's session id and a malformed id both return 404, the same as a missing
  one, so ids cannot be probed.
- **Rate limits** follow ADR-012: reset requests 10/hour per address and
  3/hour per account; confirmations 30/15 min per address.

## Not yet done

Changing the password while signed in (requires the current password and
revokes other sessions), notifying the user by email after a reset, and audit
events for these actions.
