import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ScimToken } from '@atlas/contracts';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import type { ScimTenant } from './scim.service';

const MAX_TOKENS = 2;
export const SCIM_TOKEN_PREFIX = 'atlscim_';

interface Row {
  id: string;
  prefix: string;
  created_by_user_id: string;
  display_name: string;
  created_at: Date;
  last_used_at: Date | null;
}

function toToken(row: Row): ScimToken {
  return {
    id: row.id,
    prefix: row.prefix,
    createdBy: {
      userId: row.created_by_user_id,
      displayName: row.display_name,
    },
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}

/**
 * SCIM tokens (ADR-055): owner-managed, at most two live at once so they can
 * be rotated, stored only as digests and shown once.
 */
@Injectable()
export class ScimTokensService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext): Promise<ScimToken[]> {
    const result = await this.database.pool.query<Row>(
      `SELECT t.id, t.prefix, t.created_by_user_id, u.display_name, t.created_at,
         t.last_used_at
       FROM scim_tokens t JOIN users u ON u.id = t.created_by_user_id
       WHERE t.organization_id = $1 AND t.revoked_at IS NULL
       ORDER BY t.created_at DESC`,
      [tenant.organizationId],
    );
    return result.rows.map(toToken);
  }

  async create(
    tenant: TenantContext,
    userId: string,
    request: RequestMeta,
  ): Promise<{ token: ScimToken; secret: string } | undefined> {
    const secret = `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    return this.database.transaction(async (client) => {
      await client.query(
        'SELECT id FROM organizations WHERE id = $1 FOR UPDATE',
        [tenant.organizationId],
      );
      const count = await client.query<{ count: string }>(
        `SELECT count(*) FROM scim_tokens
         WHERE organization_id = $1 AND revoked_at IS NULL`,
        [tenant.organizationId],
      );
      if (Number(count.rows[0]?.count) >= MAX_TOKENS) return undefined;
      const result = await client.query<Row>(
        `WITH t AS (
           INSERT INTO scim_tokens (organization_id, created_by_user_id, prefix, token_hash)
           VALUES ($1, $2, $3, $4) RETURNING *)
         SELECT t.id, t.prefix, t.created_by_user_id, u.display_name, t.created_at,
           t.last_used_at
         FROM t JOIN users u ON u.id = t.created_by_user_id`,
        [
          tenant.organizationId,
          userId,
          secret.slice(0, 14),
          this.auth.tokenDigest(secret),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('scim token insert returned no row');
      await this.audit.record(
        {
          action: 'scim_token.created',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'scim_token', id: row.id },
          request,
        },
        client,
      );
      return { token: toToken(row), secret };
    });
  }

  async revoke(
    tenant: TenantContext,
    userId: string,
    id: string,
    request: RequestMeta,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query(
        `UPDATE scim_tokens SET revoked_at = now()
         WHERE organization_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [tenant.organizationId, id],
      );
      if (result.rowCount !== 1) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'scim_token.revoked',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'scim_token', id },
          request,
        },
        client,
      );
    });
  }

  /** The organization for a presented token, or undefined. */
  async resolve(secret: string): Promise<ScimTenant | undefined> {
    if (!secret.startsWith(SCIM_TOKEN_PREFIX) || secret.length > 100)
      return undefined;
    const result = await this.database.pool.query<{
      id: string;
      organization_id: string;
      name: string;
    }>(
      `UPDATE scim_tokens t SET last_used_at = now()
       FROM organizations o
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL
         AND o.id = t.organization_id AND o.status = 'active'
       RETURNING t.id, t.organization_id, o.name`,
      [this.auth.tokenDigest(secret)],
    );
    const row = result.rows[0];
    return row
      ? {
          tokenId: row.id,
          organizationId: row.organization_id,
          organizationName: row.name,
        }
      : undefined;
  }
}
