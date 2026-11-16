import { Inject, Injectable, Logger } from '@nestjs/common';
import { parseAuthEnvironment } from '@atlas/config';
import type { AuthEnvironment } from '@atlas/config';
import type { LoginRequest, SignupRequest } from '@atlas/contracts';
import {
  digestToken,
  generateToken,
  hashPassword,
  verifyPassword,
} from '@atlas/shared';
import { DatabaseService } from '../database.service';
import type { AuthContext } from './http';
import { Mailer } from './mailer';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const VERIFICATION_TTL = '24 hours';
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
  async signup(input: SignupRequest): Promise<void> {
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
      return true;
    });
    if (!created) return;
    const link = `${this.config.WEB_ORIGIN}/verify-email?token=${token}`;
    try {
      await this.mailer.send({
        to: input.email,
        subject: 'Verify your Atlas email address',
        text: `Confirm your email address to finish creating your Atlas account:\n\n${link}\n\nThis link expires in 24 hours.`,
      });
    } catch {
      // The account exists; the user can request a new link once resend
      // exists. Never log the address or token.
      this.logger.error('verification email could not be sent');
    }
  }

  /** Single-use, expiring token. Returns false for unknown or used tokens. */
  async verifyEmail(token: string): Promise<boolean> {
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
      return true;
    });
  }

  /**
   * Issues a new session for verified, active accounts. Every failure returns
   * the same result so responses do not reveal which check failed.
   */
  async login(
    input: LoginRequest,
    userAgent: string | undefined,
  ): Promise<LoginResult> {
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
      return { ok: false };
    }
    const valid = await verifyPassword(input.password, user.password_hash);
    if (!valid || !user.email_verified_at || user.status !== 'active') {
      return { ok: false };
    }
    const token = generateToken();
    await this.database.pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent_summary)
       VALUES ($1, $2, now() + make_interval(secs => $3), $4)`,
      [
        user.id,
        this.digest(token),
        SESSION_TTL_SECONDS,
        userAgent?.slice(0, 256) ?? null,
      ],
    );
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

  async revoke(sessionId: string): Promise<void> {
    await this.database.pool.query(
      'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [sessionId],
    );
  }
}
