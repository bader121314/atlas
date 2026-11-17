import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { openSecret, sealSecret } from '@atlas/shared';
import type { SsoConnection } from '@atlas/contracts';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { DomainsService } from '../domains/domains.service';
import {
  OidcError,
  challengeFor,
  discover,
  fetchJson,
  randomValue,
  verifyIdToken,
} from './oidc';
import type { OutboundRules } from './oidc';

const STATE_TTL = '10 minutes';

interface Settings extends OutboundRules {
  material: string;
}

/** SSO_SECRET_KEY seals client secrets; the relaxations are ignored in production. */
export function ssoSettings(
  env: Record<string, string | undefined>,
): Settings | undefined {
  const material = env.SSO_SECRET_KEY;
  if (!material || material.length < 32) return undefined;
  const production = env.NODE_ENV === 'production';
  return {
    material,
    allowHttp: !production && env.SSO_ALLOW_HTTP === 'true',
    allowedHosts: production
      ? []
      : (env.SSO_ALLOWED_HOSTS ?? '')
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
  };
}

interface ConnectionRow {
  organization_id: string;
  issuer: string;
  client_id: string;
  client_secret_sealed: string;
  enabled: boolean;
  require_sso: boolean;
  updated_at: Date;
}

export type SsoOutcome =
  | { ok: true; token: string; slug: string }
  | { ok: false; reason: 'unavailable' | 'failed' | 'suspended' };

/**
 * OpenID Connect sign-in for organizations with verified domains (ADR-058):
 * authorization code flow with PKCE, state and nonce. People sign in as the
 * account matching their verified email, created if new, and join the
 * organization as members if they are not already in it.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DomainsService) private readonly domains: DomainsService,
  ) {}

  private settings(): Settings {
    const settings = ssoSettings(process.env);
    if (!settings) throw new ServiceUnavailableException();
    return settings;
  }

  webOrigin(): string {
    return this.auth.config.WEB_ORIGIN;
  }

  redirectUri(): string {
    return `${this.auth.config.WEB_ORIGIN}/api/auth/sso/callback`;
  }

  async get(tenant: TenantContext): Promise<SsoConnection> {
    const result = await this.database.pool.query<ConnectionRow>(
      'SELECT * FROM sso_connections WHERE organization_id = $1',
      [tenant.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return this.toConnection(row);
  }

  private toConnection(row: ConnectionRow): SsoConnection {
    return {
      issuer: row.issuer,
      clientId: row.client_id,
      enabled: row.enabled,
      requireSso: row.require_sso,
      redirectUri: this.redirectUri(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  /** Saves settings after checking the issuer's discovery document. */
  async put(
    tenant: TenantContext,
    userId: string,
    input: {
      issuer: string;
      clientId: string;
      clientSecret?: string | undefined;
      enabled: boolean;
      requireSso: boolean;
    },
    request: RequestMeta,
  ): Promise<
    SsoConnection | 'invalid-issuer' | 'secret-required' | 'no-domain'
  > {
    const settings = this.settings();
    if (
      input.enabled &&
      (await this.domains.verifiedDomains(tenant.organizationId)).length === 0
    )
      return 'no-domain';
    try {
      await discover(input.issuer, settings);
    } catch {
      return 'invalid-issuer';
    }
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ client_secret_sealed: string }>(
        'SELECT client_secret_sealed FROM sso_connections WHERE organization_id = $1 FOR UPDATE',
        [tenant.organizationId],
      );
      const sealed = input.clientSecret
        ? sealSecret(input.clientSecret, settings.material)
        : existing.rows[0]?.client_secret_sealed;
      if (!sealed) return 'secret-required' as const;
      const saved = await client.query<ConnectionRow>(
        `INSERT INTO sso_connections (organization_id, issuer, client_id,
           client_secret_sealed, enabled, require_sso, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (organization_id) DO UPDATE SET
           issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id,
           client_secret_sealed = EXCLUDED.client_secret_sealed,
           enabled = EXCLUDED.enabled, require_sso = EXCLUDED.require_sso,
           updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
         RETURNING *`,
        [
          tenant.organizationId,
          input.issuer,
          input.clientId,
          sealed,
          input.enabled,
          input.requireSso,
          userId,
        ],
      );
      const row = saved.rows[0];
      if (!row) throw new Error('sso upsert returned no row');
      await this.audit.record(
        {
          action: 'org.sso.updated',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'organization', id: tenant.organizationId },
          metadata: {
            enabled: input.enabled,
            requireSso: input.requireSso,
            secretChanged: Boolean(input.clientSecret),
          },
          request,
        },
        client,
      );
      return this.toConnection(row);
    });
  }

  async remove(
    tenant: TenantContext,
    userId: string,
    request: RequestMeta,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query(
        'DELETE FROM sso_connections WHERE organization_id = $1',
        [tenant.organizationId],
      );
      if (result.rowCount !== 1) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'org.sso.removed',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'organization', id: tenant.organizationId },
          request,
        },
        client,
      );
    });
  }

  /** The enabled connection responsible for an email's verified domain. */
  private async connectionFor(
    email: string,
  ): Promise<ConnectionRow | undefined> {
    const domain = email.split('@')[1] ?? '';
    const result = await this.database.pool.query<ConnectionRow>(
      `SELECT c.* FROM sso_connections c
       JOIN organization_domains d
         ON d.organization_id = c.organization_id AND d.verified_at IS NOT NULL
       JOIN organizations o ON o.id = c.organization_id AND o.status = 'active'
       WHERE d.domain = $1 AND c.enabled`,
      [domain],
    );
    return result.rows[0];
  }

  /** The provider URL to send the browser to, or undefined. */
  async start(email: string): Promise<string | undefined> {
    const settings = ssoSettings(process.env);
    if (!settings) return undefined;
    const connection = await this.connectionFor(email);
    if (!connection) return undefined;
    let discovery;
    try {
      discovery = await discover(connection.issuer, settings);
    } catch {
      this.logger.warn('sso discovery failed');
      return undefined;
    }
    const state = randomValue();
    const nonce = randomValue(24);
    const verifier = randomValue(48);
    await this.database.pool.query(
      `DELETE FROM sso_states WHERE expires_at < now()`,
    );
    await this.database.pool.query(
      `INSERT INTO sso_states (state_hash, organization_id, nonce, code_verifier, expires_at)
       VALUES ($1, $2, $3, $4, now() + $5::interval)`,
      [
        this.auth.tokenDigest(state),
        connection.organization_id,
        nonce,
        verifier,
        STATE_TTL,
      ],
    );
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', connection.client_id);
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challengeFor(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('login_hint', email);
    return url.toString();
  }

  /** Completes sign-in. The state is single use whatever the outcome. */
  async callback(
    state: string,
    code: string | undefined,
    request: RequestMeta,
  ): Promise<SsoOutcome> {
    const settings = ssoSettings(process.env);
    if (!settings) return { ok: false, reason: 'unavailable' };
    const claimed = await this.database.pool.query<{
      organization_id: string;
      nonce: string;
      code_verifier: string;
    }>(
      `DELETE FROM sso_states WHERE state_hash = $1 AND expires_at > now()
       RETURNING organization_id, nonce, code_verifier`,
      [this.auth.tokenDigest(state)],
    );
    const attempt = claimed.rows[0];
    if (!attempt || !code) return { ok: false, reason: 'failed' };
    const connection = (
      await this.database.pool.query<ConnectionRow & { slug: string }>(
        `SELECT c.*, o.slug FROM sso_connections c
         JOIN organizations o ON o.id = c.organization_id AND o.status = 'active'
         WHERE c.organization_id = $1 AND c.enabled`,
        [attempt.organization_id],
      )
    ).rows[0];
    if (!connection) return { ok: false, reason: 'unavailable' };
    let claims;
    try {
      const discovery = await discover(connection.issuer, settings);
      const tokens = (await fetchJson(discovery.token_endpoint, settings, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri(),
          client_id: connection.client_id,
          client_secret: openSecret(
            connection.client_secret_sealed,
            settings.material,
          ),
          code_verifier: attempt.code_verifier,
        }).toString(),
      })) as { id_token?: unknown };
      if (typeof tokens.id_token !== 'string')
        throw new OidcError('no id token');
      const jwks = (await fetchJson(discovery.jwks_uri, settings)) as {
        keys?: unknown;
      };
      claims = verifyIdToken(
        tokens.id_token,
        Array.isArray(jwks.keys) ? (jwks.keys as never[]) : [],
        {
          issuer: connection.issuer,
          audience: connection.client_id,
          nonce: attempt.nonce,
        },
      );
    } catch (error) {
      await this.audit.record({
        action: 'auth.sso.failed',
        organizationId: connection.organization_id,
        metadata: {
          reason: error instanceof OidcError ? error.message : 'error',
        },
        request,
      });
      return { ok: false, reason: 'failed' };
    }
    const domain = claims.email.split('@')[1] ?? '';
    if (
      !(
        await this.domains.verifiedDomains(connection.organization_id)
      ).includes(domain)
    ) {
      await this.audit.record({
        action: 'auth.sso.failed',
        organizationId: connection.organization_id,
        metadata: { reason: 'domain not verified' },
        request,
      });
      return { ok: false, reason: 'failed' };
    }
    const userId = await this.database.transaction(async (client) => {
      const existing = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM users WHERE email_normalized = $1 FOR UPDATE',
        [claims.email],
      );
      let id = existing.rows[0]?.id;
      if (existing.rows[0] && existing.rows[0].status !== 'active')
        return undefined;
      if (!id) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO users (email_normalized, display_name, email_verified_at)
           VALUES ($1, $2, now()) RETURNING id`,
          [
            claims.email,
            (claims.name ?? claims.email.split('@')[0] ?? 'Member').slice(
              0,
              100,
            ),
          ],
        );
        id = created.rows[0]?.id;
      } else {
        // The provider vouched for the address on a verified domain.
        await client.query(
          'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
          [id],
        );
      }
      if (!id) throw new Error('user insert returned no row');
      const membership = await client.query<{ state: string }>(
        `SELECT state FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2 FOR UPDATE`,
        [connection.organization_id, id],
      );
      const state = membership.rows[0]?.state;
      if (state === 'suspended') return 'suspended' as const;
      if (state !== 'active') {
        await client.query(
          `INSERT INTO organization_memberships (organization_id, user_id, role)
           VALUES ($1, $2, 'member')
           ON CONFLICT (organization_id, user_id) DO UPDATE
             SET role = 'member', state = 'active', joined_at = now(), updated_at = now()`,
          [connection.organization_id, id],
        );
        await this.audit.record(
          {
            action: 'org.member.joined',
            actorUserId: id,
            organizationId: connection.organization_id,
            target: { type: 'user', id },
            metadata: { role: 'member', via: 'sso' },
            request,
          },
          client,
        );
      }
      return id;
    });
    if (userId === 'suspended') return { ok: false, reason: 'suspended' };
    if (!userId) return { ok: false, reason: 'failed' };
    const token = await this.auth.issueSession(userId, request, 'sso');
    return { ok: true, token, slug: connection.slug };
  }
}
