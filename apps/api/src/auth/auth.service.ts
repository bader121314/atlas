import { Inject, Injectable, Logger } from '@nestjs/common';
import { parseAuthEnvironment } from '@atlas/config';
import type { AuthEnvironment } from '@atlas/config';
import type {
  LoginRequest,
  SessionListResponse,
  SignupRequest,
} from '@atlas/contracts';
import {
  digestToken,
  generateToken,
  hashPassword,
  verifyPassword,
} from '@atlas/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import { DatabaseService } from '../database.service';
import type { AuthContext } from './http';
import { Mailer } from './mailer';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const VERIFICATION_TTL = '24 hours';
const PASSWORD_RESET_TTL = '1 hour';
const LAST_SEEN_RESOLUTION = '5 minutes';

export type LoginResult = { ok: true; token: string } | { ok: false };

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private settings: AuthEnvironment | undefined;
  // Used when an email is unknown so failed logins cost the same time.
  private decoyHash: Promise<string> | undefined;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  get config(): AuthEnvironment {
    this.settings ??= parseAuthEnvironment(process.env);
    return this.settings;
  }

  private digest(token: string): Buffer {
    return digestToken(token, this.config.SESSION_SECRET);
  }

  /**
   * Creates an unverified account and emails a verification link. Returns
   * nothing either way, so callers cannot learn whether an email exists.
   */
  async signup(input: SignupRequest, request: RequestMeta): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    const token = generateToken();
    const created = await this.database.transaction(async (client) => {
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email_normalized, display_name, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
        [input.email, input.displayName, passwordHash],
      );
      const userId = user.rows[0]?.id;
      if (!userId) return false;
      await client.query(
        `INSERT INTO verification_tokens (user_id, purpose, token_hash, expires_at)
         VALUES ($1, 'email_verification', $2, now() + $3::interval)`,
        [userId, this.digest(token), VERIFICATION_TTL],
      );
      await this.audit.record(
        {
          action: 'auth.signup.created',
          actorUserId: userId,
          target: { type: 'user', id: userId },
          request,
        },
        client,
      );
      return true;
    });
    if (created) await this.sendVerification(input.email, token);
  }

  /**
   * Issues a fresh link for an unverified account and invalidates older ones.
   * Silent for unknown or already verified emails, like signup.
   */
  async resendVerification(email: string): Promise<void> {
    const token = generateToken();
    const issued = await this.database.transaction(async (client) => {
      const user = await client.query<{ id: string }>(
        `SELECT id FROM users
         WHERE email_normalized = $1 AND email_verified_at IS NULL
           AND status = 'active'
         FOR UPDATE`,
        [email],
      );
      const userId = user.rows[0]?.id;
      if (!userId) return false;
      await client.query(
        `UPDATE verification_tokens SET used_at = now()
         WHERE user_id = $1 AND purpose = 'email_verification'
           AND used_at IS NULL`,
        [userId],
      );
      await client.query(
        `INSERT INTO verification_tokens (user_id, purpose, token_hash, expires_at)
         VALUES ($1, 'email_verification', $2, now() + $3::interval)`,
        [userId, this.digest(token), VERIFICATION_TTL],
      );
      return true;
    });
    if (issued) await this.sendVerification(email, token);
  }

  private async sendVerification(email: string, token: string): Promise<void> {
    const link = `${this.config.WEB_ORIGIN}/verify-email?token=${token}`;
    try {
      await this.mailer.send({
        to: email,
        subject: 'Verify your Atlas email address',
        text: `Confirm your email address to finish creating your Atlas account:\n\n${link}\n\nThis link expires in 24 hours.`,
      });
    } catch {
      // Never log the address or token; the user can request a new link.
      this.logger.error('verification email could not be sent');
    }
  }

  /** Single-use, expiring token. Returns false for unknown or used tokens. */
  async verifyEmail(token: string, request: RequestMeta): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const used = await client.query<{ user_id: string }>(
        `UPDATE verification_tokens SET used_at = now()
         WHERE token_hash = $1 AND purpose = 'email_verification'
           AND used_at IS NULL AND expires_at > now()
         RETURNING user_id`,
        [this.digest(token)],
      );
      const userId = used.rows[0]?.user_id;
      if (!userId) return false;
      await client.query(
        `UPDATE users
         SET email_verified_at = COALESCE(email_verified_at, now()),
             updated_at = now()
         WHERE id = $1`,
        [userId],
      );
      await this.audit.record(
        {
          action: 'auth.email.verified',
          actorUserId: userId,
          target: { type: 'user', id: userId },
          request,
        },
        client,
      );
      return true;
    });
  }

  /**
   * Issues a new session for verified, active accounts. Every failure returns
   * the same result so responses do not reveal which check failed.
   */
  async login(input: LoginRequest, request: RequestMeta): Promise<LoginResult> {
    const result = await this.database.pool.query<{
      id: string;
      password_hash: string | null;
      email_verified_at: Date | null;
      status: string;
    }>(
      `SELECT id, password_hash, email_verified_at, status
       FROM users WHERE email_normalized = $1`,
      [input.email],
    );
    const user = result.rows[0];
    if (!user?.password_hash) {
      this.decoyHash ??= hashPassword(generateToken());
      await verifyPassword(input.password, await this.decoyHash);
      await this.audit.record({
        action: 'auth.login.failed',
        metadata: { reason: 'unknown_account' },
        request,
      });
      return { ok: false };
    }
    const valid = await verifyPassword(input.password, user.password_hash);
    const reason = !valid
      ? 'invalid_password'
      : !user.email_verified_at
        ? 'email_unverified'
        : user.status !== 'active'
          ? 'account_inactive'
          : undefined;
    if (reason) {
      await this.audit.record({
        action: 'auth.login.failed',
        target: { type: 'user', id: user.id },
        metadata: { reason },
        request,
      });
      return { ok: false };
    }
    const token = generateToken();
    const session = await this.database.pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent_summary)
       VALUES ($1, $2, now() + make_interval(secs => $3), $4)
       RETURNING id`,
      [
        user.id,
        this.digest(token),
        SESSION_TTL_SECONDS,
        request.userAgent?.slice(0, 256) ?? null,
      ],
    );
    const sessionId = session.rows[0]?.id;
    if (sessionId) {
      await this.audit.record({
        action: 'auth.login.succeeded',
        actorUserId: user.id,
        target: { type: 'session', id: sessionId },
        request,
      });
    }
    return { ok: true, token };
  }

  /** Resolves a live session; revoked, expired or disabled ones are rejected. */
  async authenticate(token: string): Promise<AuthContext | undefined> {
    const result = await this.database.pool.query<{
      session_id: string;
      user_id: string;
      email_normalized: string;
      display_name: string;
    }>(
      `SELECT s.id AS session_id, u.id AS user_id,
         u.email_normalized, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.status = 'active'`,
      [this.digest(token)],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    // Only write when the stored value is stale, to avoid a write per request.
    await this.database.pool.query(
      `UPDATE sessions SET last_seen_at = now()
       WHERE id = $1
         AND (last_seen_at IS NULL OR last_seen_at < now() - $2::interval)`,
      [row.session_id, LAST_SEEN_RESOLUTION],
    );
    return {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        email: row.email_normalized,
        displayName: row.display_name,
      },
    };
  }

  /**
   * Resolves an API token (ADR-037): not revoked or expired, owned by an
   * active user who is still an active member of the token's organization.
   */
  async authenticateApiToken(raw: string): Promise<AuthContext | undefined> {
    if (!raw.startsWith('atl_')) return undefined;
    const result = await this.database.pool.query<{
      id: string;
      organization_id: string;
      scopes: string[];
      user_id: string;
      email_normalized: string;
      display_name: string;
    }>(
      `SELECT t.id, t.organization_id, t.scopes, u.id AS user_id,
         u.email_normalized, u.display_name
       FROM api_tokens t
       JOIN users u ON u.id = t.user_id
       JOIN organization_memberships m
         ON m.organization_id = t.organization_id AND m.user_id = t.user_id
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()
         AND u.status = 'active' AND m.state = 'active'`,
      [this.digest(raw)],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    await this.database.pool.query(
      `UPDATE api_tokens SET last_used_at = now()
       WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - $2::interval)`,
      [row.id, LAST_SEEN_RESOLUTION],
    );
    return {
      sessionId: `token:${row.id}`,
      user: {
        id: row.user_id,
        email: row.email_normalized,
        displayName: row.display_name,
      },
      token: {
        id: row.id,
        organizationId: row.organization_id,
        scopes: row.scopes,
      },
    };
  }

  /** The digest stored for an API token (shared with token creation). */
  tokenDigest(raw: string): Buffer {
    return this.digest(raw);
  }

  /**
   * Emails a single-use reset link to verified, active accounts and
   * invalidates earlier links. Silent otherwise, so responses match.
   */
  async requestPasswordReset(
    email: string,
    request: RequestMeta,
    /** Set for people provisioned by SCIM: a welcome with a longer link (ADR-055). */
    welcome?: { organizationName: string },
  ): Promise<void> {
    const token = generateToken();
    const issued = await this.database.transaction(async (client) => {
      const user = await client.query<{ id: string }>(
        `SELECT id FROM users
         WHERE email_normalized = $1 AND email_verified_at IS NOT NULL
           AND status = 'active'
         FOR UPDATE`,
        [email],
      );
      const userId = user.rows[0]?.id;
      if (!userId) return false;
      await client.query(
        `UPDATE verification_tokens SET used_at = now()
         WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
        [userId],
      );
      await client.query(
        `INSERT INTO verification_tokens (user_id, purpose, token_hash, expires_at)
         VALUES ($1, 'password_reset', $2, now() + $3::interval)`,
        [userId, this.digest(token), welcome ? '7 days' : PASSWORD_RESET_TTL],
      );
      await this.audit.record(
        {
          action: 'auth.password_reset.requested',
          target: { type: 'user', id: userId },
          request,
        },
        client,
      );
      return true;
    });
    if (!issued) return;
    const link = `${this.config.WEB_ORIGIN}/reset-password?token=${token}`;
    try {
      await this.mailer.send(
        welcome
          ? {
              to: email,
              subject: `You have been added to ${welcome.organizationName} on Atlas`,
              text: `Your organization added you to ${welcome.organizationName} on Atlas. Choose a password to sign in:\n\n${link}\n\nThis link expires in 7 days. Afterwards, use "Forgot password" on the sign-in page.`,
            }
          : {
              to: email,
              subject: 'Reset your Atlas password',
              text: `Someone asked to reset the password for your Atlas account. If it was you, choose a new password here:\n\n${link}\n\nThis link expires in 1 hour. If you did not ask, you can ignore this email; your password has not changed.`,
            },
      );
    } catch {
      this.logger.error('password reset email could not be sent');
    }
  }

  /**
   * Consumes a reset token, sets the new password and signs the account out
   * everywhere, all in one transaction. Returns false for invalid tokens.
   */
  async confirmPasswordReset(
    token: string,
    password: string,
    request: RequestMeta,
  ): Promise<boolean> {
    const passwordHash = await hashPassword(password);
    return this.database.transaction(async (client) => {
      const used = await client.query<{ user_id: string }>(
        `UPDATE verification_tokens SET used_at = now()
         WHERE token_hash = $1 AND purpose = 'password_reset'
           AND used_at IS NULL AND expires_at > now()
         RETURNING user_id`,
        [this.digest(token)],
      );
      const userId = used.rows[0]?.user_id;
      if (!userId) return false;
      const updated = await client.query(
        `UPDATE users SET password_hash = $2, updated_at = now()
         WHERE id = $1 AND status = 'active'`,
        [userId, passwordHash],
      );
      if (updated.rowCount !== 1) return false;
      const revoked = await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      await this.audit.record(
        {
          action: 'auth.password_reset.completed',
          actorUserId: userId,
          target: { type: 'user', id: userId },
          metadata: { sessionsRevoked: revoked.rowCount ?? 0 },
          request,
        },
        client,
      );
      return true;
    });
  }

  /**
   * Changes the password of a signed-in user who proves the current one,
   * and signs out every other device. Returns false if the current
   * password is wrong.
   */
  async changePassword(
    caller: AuthContext,
    currentPassword: string,
    newPassword: string,
    request: RequestMeta,
  ): Promise<boolean> {
    const user = await this.database.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1 AND status = 'active'`,
      [caller.user.id],
    );
    const hash = user.rows[0]?.password_hash;
    if (!hash || !(await verifyPassword(currentPassword, hash))) return false;
    const passwordHash = await hashPassword(newPassword);
    await this.database.transaction(async (client) => {
      await client.query(
        'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1',
        [caller.user.id, passwordHash],
      );
      const revoked = await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [caller.user.id, caller.sessionId],
      );
      await this.audit.record(
        {
          action: 'auth.password.changed',
          actorUserId: caller.user.id,
          target: { type: 'user', id: caller.user.id },
          metadata: { otherSessionsRevoked: revoked.rowCount ?? 0 },
          request,
        },
        client,
      );
    });
    return true;
  }

  /** Active sessions for one user; never returns another user's sessions. */
  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionListResponse> {
    const result = await this.database.pool.query<{
      id: string;
      issued_at: Date;
      last_seen_at: Date | null;
      expires_at: Date;
      user_agent_summary: string | null;
    }>(
      `SELECT id, issued_at, last_seen_at, expires_at, user_agent_summary
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY issued_at DESC
       LIMIT 100`,
      [userId],
    );
    return {
      sessions: result.rows.map((row) => ({
        id: row.id,
        current: row.id === currentSessionId,
        issuedAt: row.issued_at.toISOString(),
        lastSeenAt: row.last_seen_at?.toISOString() ?? null,
        expiresAt: row.expires_at.toISOString(),
        userAgent: row.user_agent_summary,
      })),
    };
  }

  /** Revokes one of the caller's own sessions. False if not theirs or gone. */
  async revokeOwnSession(
    userId: string,
    sessionId: string,
    request: RequestMeta,
  ): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const result = await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [sessionId, userId],
      );
      if (result.rowCount !== 1) return false;
      await this.audit.record(
        {
          action: 'auth.session.revoked',
          actorUserId: userId,
          target: { type: 'session', id: sessionId },
          request,
        },
        client,
      );
      return true;
    });
  }

  /** Signs out every other device; returns how many sessions were revoked. */
  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    request: RequestMeta,
  ): Promise<number> {
    return this.database.transaction(async (client) => {
      const result = await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [userId, currentSessionId],
      );
      const count = result.rowCount ?? 0;
      await this.audit.record(
        {
          action: 'auth.sessions.revoked_others',
          actorUserId: userId,
          metadata: { sessionsRevoked: count },
          request,
        },
        client,
      );
      return count;
    });
  }

  async logout(context: AuthContext, request: RequestMeta): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
        [context.sessionId],
      );
      await this.audit.record(
        {
          action: 'auth.logout',
          actorUserId: context.user.id,
          target: { type: 'session', id: context.sessionId },
          request,
        },
        client,
      );
    });
  }
}
