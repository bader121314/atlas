import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ApiToken, CreateApiTokenRequest } from '@atlas/contracts';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

const MAX_TOKENS = 20;

interface Row {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiToken['scopes'];
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
}

const COLUMNS =
  'id, name, prefix, scopes, created_at, expires_at, last_used_at';

function toToken(row: Row): ApiToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}

/** A person's API tokens in one organization (ADR-037). */
@Injectable()
export class ApiTokensService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext, userId: string): Promise<ApiToken[]> {
    const result = await this.database.pool.query<Row>(
      `SELECT ${COLUMNS} FROM api_tokens
       WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL
         AND expires_at > now()
       ORDER BY created_at DESC`,
      [tenant.organizationId, userId],
    );
    return result.rows.map(toToken);
  }

  /** Creates a token; the raw value is returned this once only. */
  async create(
    tenant: TenantContext,
    userId: string,
    input: CreateApiTokenRequest,
    request: RequestMeta,
  ): Promise<{ token: ApiToken; secret: string } | undefined> {
    const raw = `atl_${randomBytes(32).toString('base64url')}`;
    return this.database.transaction(async (client) => {
      const count = await client.query<{ count: string }>(
        `SELECT count(*) FROM api_tokens WHERE organization_id = $1 AND user_id = $2
           AND revoked_at IS NULL AND expires_at > now()`,
        [tenant.organizationId, userId],
      );
      if (Number(count.rows[0]?.count) >= MAX_TOKENS) return undefined;
      const result = await client.query<Row>(
        `INSERT INTO api_tokens (organization_id, user_id, name, prefix, token_hash,
           scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 * interval '1 day'))
         RETURNING ${COLUMNS}`,
        [
          tenant.organizationId,
          userId,
          input.name,
          raw.slice(0, 12),
          this.auth.tokenDigest(raw),
          input.scopes,
          input.expiresInDays,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('token insert returned no row');
      await this.audit.record(
        {
          action: 'api_token.created',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'api_token', id: row.id },
          metadata: { scopes: input.scopes.join(' ') },
          request,
        },
        client,
      );
      return { token: toToken(row), secret: raw };
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
        `UPDATE api_tokens SET revoked_at = now()
         WHERE organization_id = $1 AND user_id = $2 AND id = $3 AND revoked_at IS NULL`,
        [tenant.organizationId, userId, id],
      );
      if (result.rowCount !== 1) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'api_token.revoked',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'api_token', id },
          request,
        },
        client,
      );
    });
  }
}
