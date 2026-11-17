import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DatabaseError } from 'pg';
import type { OrganizationDomain } from '@atlas/contracts';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { DomainResolver } from './domain-resolver';

const MAX_DOMAINS = 10;
const PREFIX = 'atlas-domain-verification=';

interface Row {
  id: string;
  domain: string;
  verification_token: string;
  verified_at: Date | null;
}

function toDomain(row: Row): OrganizationDomain {
  return {
    id: row.id,
    domain: row.domain,
    verified: row.verified_at !== null,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    record: {
      name: `_atlas-challenge.${row.domain}`,
      value: `${PREFIX}${row.verification_token}`,
    },
  };
}

/**
 * Verified email domains (ADR-057). Proving control of a domain lets an
 * organization limit provisioning to it and, with SSO, route its people to
 * their identity provider. One organization can hold a verified domain.
 */
@Injectable()
export class DomainsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DomainResolver) private readonly resolver: DomainResolver,
  ) {}

  async list(tenant: TenantContext): Promise<OrganizationDomain[]> {
    const result = await this.database.pool.query<Row>(
      `SELECT id, domain, verification_token, verified_at FROM organization_domains
       WHERE organization_id = $1 ORDER BY domain`,
      [tenant.organizationId],
    );
    return result.rows.map(toDomain);
  }

  async add(
    tenant: TenantContext,
    userId: string,
    domain: string,
    request: RequestMeta,
  ): Promise<OrganizationDomain> {
    return this.database.transaction(async (client) => {
      await client.query(
        'SELECT id FROM organizations WHERE id = $1 FOR UPDATE',
        [tenant.organizationId],
      );
      const count = await client.query<{ count: string }>(
        'SELECT count(*) FROM organization_domains WHERE organization_id = $1',
        [tenant.organizationId],
      );
      if (Number(count.rows[0]?.count) >= MAX_DOMAINS)
        throw new ConflictException('At most 10 domains');
      const inserted = await client
        .query<Row>(
          `INSERT INTO organization_domains (organization_id, domain,
             verification_token, created_by_user_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, domain, verification_token, verified_at`,
          [
            tenant.organizationId,
            domain,
            randomBytes(24).toString('base64url'),
            userId,
          ],
        )
        .catch((error: unknown) => {
          if (error instanceof DatabaseError && error.code === '23505')
            throw new ConflictException('Domain already added');
          throw error;
        });
      const row = inserted.rows[0];
      if (!row) throw new Error('domain insert returned no row');
      await this.audit.record(
        {
          action: 'org.domain.added',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'domain', id: row.id },
          metadata: { domain },
          request,
        },
        client,
      );
      return toDomain(row);
    });
  }

  /** Looks up the TXT record; 409 when it is missing or the domain is taken. */
  async verify(
    tenant: TenantContext,
    userId: string,
    id: string,
    request: RequestMeta,
  ): Promise<OrganizationDomain> {
    const found = await this.database.pool.query<Row>(
      `SELECT id, domain, verification_token, verified_at FROM organization_domains
       WHERE organization_id = $1 AND id = $2`,
      [tenant.organizationId, id],
    );
    const row = found.rows[0];
    if (!row) throw new NotFoundException();
    if (row.verified_at) return toDomain(row);
    const records = await this.resolver.txt(`_atlas-challenge.${row.domain}`);
    if (!records.includes(`${PREFIX}${row.verification_token}`))
      throw new ConflictException('Verification record not found');
    return this.database.transaction(async (client) => {
      const updated = await client
        .query<Row>(
          `UPDATE organization_domains SET verified_at = now()
           WHERE organization_id = $1 AND id = $2 AND verified_at IS NULL
           RETURNING id, domain, verification_token, verified_at`,
          [tenant.organizationId, id],
        )
        .catch((error: unknown) => {
          if (error instanceof DatabaseError && error.code === '23505')
            throw new ConflictException(
              'Domain verified by another organization',
            );
          throw error;
        });
      const verified = updated.rows[0];
      if (!verified) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'org.domain.verified',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'domain', id },
          metadata: { domain: verified.domain },
          request,
        },
        client,
      );
      return toDomain(verified);
    });
  }

  async remove(
    tenant: TenantContext,
    userId: string,
    id: string,
    request: RequestMeta,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ domain: string }>(
        `DELETE FROM organization_domains WHERE organization_id = $1 AND id = $2
         RETURNING domain`,
        [tenant.organizationId, id],
      );
      const domain = result.rows[0]?.domain;
      if (!domain) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'org.domain.removed',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'domain', id },
          metadata: { domain },
          request,
        },
        client,
      );
    });
  }

  /** Verified domains of an organization, for provisioning and SSO. */
  async verifiedDomains(organizationId: string): Promise<string[]> {
    const result = await this.database.pool.query<{ domain: string }>(
      `SELECT domain FROM organization_domains
       WHERE organization_id = $1 AND verified_at IS NOT NULL`,
      [organizationId],
    );
    return result.rows.map((r) => r.domain);
  }
}
