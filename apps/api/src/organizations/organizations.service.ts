import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { DatabaseError } from 'pg';
import type {
  CreateOrganizationRequest,
  MemberListResponse,
  Organization,
  OrganizationListResponse,
} from '@atlas/contracts';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  role: Organization['role'];
  created_at: Date;
}

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

const MEMBERSHIP_JOIN = `
  FROM organizations o
  JOIN organization_memberships m
    ON m.organization_id = o.id AND m.state = 'active'
  WHERE o.status = 'active'`;

/**
 * Every query is scoped by the caller's user id or by the organization id
 * that TenantGuard resolved; ids from request bodies are never trusted.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    input: CreateOrganizationRequest,
    request: RequestMeta,
  ): Promise<Organization> {
    try {
      return await this.database.transaction(async (client) => {
        const created = await client.query<OrganizationRow>(
          `INSERT INTO organizations (slug, name, created_by_user_id)
           VALUES ($1, $2, $3)
           RETURNING id, slug, name, 'owner' AS role, created_at`,
          [input.slug, input.name, userId],
        );
        const row = created.rows[0];
        if (!row) throw new Error('organization insert returned no row');
        // The deferred active-owner trigger (ADR-010) requires this row
        // before COMMIT.
        await client.query(
          `INSERT INTO organization_memberships (organization_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [row.id, userId],
        );
        await this.audit.record(
          {
            action: 'org.created',
            actorUserId: userId,
            organizationId: row.id,
            target: { type: 'organization', id: row.id },
            request,
          },
          client,
        );
        return toOrganization(row);
      });
    } catch (error) {
      if (
        error instanceof DatabaseError &&
        error.constraint === 'organizations_slug_key'
      ) {
        throw new ConflictException();
      }
      throw error;
    }
  }

  async listForUser(userId: string): Promise<OrganizationListResponse> {
    const result = await this.database.pool.query<OrganizationRow>(
      `SELECT o.id, o.slug, o.name, m.role, o.created_at
       ${MEMBERSHIP_JOIN} AND m.user_id = $1
       ORDER BY o.name, o.slug
       LIMIT 200`,
      [userId],
    );
    return { organizations: result.rows.map(toOrganization) };
  }

  /** Resolves a slug to the caller's active membership, or undefined. */
  async resolveMembership(
    slug: string,
    userId: string,
  ): Promise<TenantContext | undefined> {
    const result = await this.database.pool.query<{
      id: string;
      slug: string;
      role: string;
    }>(
      `SELECT o.id, o.slug, m.role
       ${MEMBERSHIP_JOIN} AND o.slug = $1 AND m.user_id = $2`,
      [slug, userId],
    );
    const row = result.rows[0];
    return row
      ? { organizationId: row.id, slug: row.slug, role: row.role }
      : undefined;
  }

  async get(tenant: TenantContext): Promise<Organization> {
    const result = await this.database.pool.query<OrganizationRow>(
      `SELECT id, slug, name, $2::text AS role, created_at
       FROM organizations WHERE id = $1`,
      [tenant.organizationId, tenant.role],
    );
    const row = result.rows[0];
    if (!row) throw new Error('organization vanished after authorization');
    return toOrganization(row);
  }

  async rename(
    tenant: TenantContext,
    actorUserId: string,
    name: string,
    request: RequestMeta,
  ): Promise<Organization> {
    return this.database.transaction(async (client) => {
      const result = await client.query<OrganizationRow>(
        `UPDATE organizations SET name = $2, updated_at = now()
         WHERE id = $1
         RETURNING id, slug, name, $3::text AS role, created_at`,
        [tenant.organizationId, name, tenant.role],
      );
      const row = result.rows[0];
      if (!row) throw new Error('organization vanished after authorization');
      await this.audit.record(
        {
          action: 'org.updated',
          actorUserId,
          organizationId: tenant.organizationId,
          target: { type: 'organization', id: tenant.organizationId },
          metadata: { fields: 'name' },
          request,
        },
        client,
      );
      return toOrganization(row);
    });
  }

  async listMembers(tenant: TenantContext): Promise<MemberListResponse> {
    const result = await this.database.pool.query<{
      user_id: string;
      display_name: string;
      email_normalized: string;
      role: Organization['role'];
      joined_at: Date;
    }>(
      `SELECT u.id AS user_id, u.display_name, u.email_normalized, m.role,
         m.joined_at
       FROM organization_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.state = 'active'
       ORDER BY m.joined_at, u.display_name
       LIMIT 500`,
      [tenant.organizationId],
    );
    return {
      members: result.rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email_normalized,
        role: row.role,
        joinedAt: row.joined_at.toISOString(),
      })),
    };
  }
}
