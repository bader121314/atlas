import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { scimBoolean } from '@atlas/contracts';
import type { ScimUserInput } from '@atlas/contracts';
import { AuditService } from '../audit/audit.service';
import type { AuditAction, RequestMeta } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { DatabaseService } from '../database.service';
import { ScimError } from './scim.errors';

export const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

/** The organization a SCIM token belongs to. */
export interface ScimTenant {
  organizationId: string;
  organizationName: string;
  tokenId: string;
}

interface MemberRow {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  state: 'active' | 'suspended' | 'removed';
  scim_external_id: string | null;
  joined_at: Date;
  updated_at: Date;
}

export interface ScimUser {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  displayName: string;
  name: { formatted: string };
  emails: { value: string; primary: boolean }[];
  active: boolean;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location: string;
  };
}

const MEMBER_SELECT = `
  SELECT m.user_id, u.email_normalized AS email, u.display_name, m.role,
    m.state, m.scim_external_id, m.joined_at, m.updated_at
  FROM organization_memberships m JOIN users u ON u.id = m.user_id`;

function toUser(row: MemberRow): ScimUser {
  return {
    schemas: [SCIM_USER],
    id: row.user_id,
    ...(row.scim_external_id ? { externalId: row.scim_external_id } : {}),
    userName: row.email,
    displayName: row.display_name,
    name: { formatted: row.display_name },
    emails: [{ value: row.email, primary: true }],
    active: row.state === 'active',
    meta: {
      resourceType: 'User',
      created: row.joined_at.toISOString(),
      lastModified: row.updated_at.toISOString(),
      location: `/v1/scim/v2/Users/${row.user_id}`,
    },
  };
}

function displayNameOf(input: ScimUserInput): string {
  const name = input.name;
  const joined = [name?.givenName, name?.familyName].filter(Boolean).join(' ');
  return (
    input.displayName ??
    (name?.formatted || joined || input.userName.split('@')[0] || 'New member')
  ).slice(0, 100);
}

/**
 * SCIM 2.0 users (ADR-055). Provisioning manages membership of one
 * organization: it never changes an account's email, name or password, and
 * never touches owners or admins, so an identity provider cannot reach
 * beyond the organization that issued its token.
 */
@Injectable()
export class ScimService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async member(
    runner: Pick<PoolClient, 'query'>,
    tenant: ScimTenant,
    userId: string,
    lock = false,
  ): Promise<MemberRow> {
    const result = await runner.query<MemberRow>(
      `${MEMBER_SELECT}
       WHERE m.organization_id = $1 AND m.user_id = $2 AND m.state <> 'removed'
       ${lock ? 'FOR UPDATE OF m' : ''}`,
      [tenant.organizationId, userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }

  async list(
    tenant: ScimTenant,
    filter: { attribute: 'userName' | 'externalId'; value: string } | null,
    startIndex: number,
    count: number,
  ) {
    const column =
      filter?.attribute === 'externalId'
        ? 'm.scim_external_id'
        : 'u.email_normalized';
    const where = `m.organization_id = $1 AND m.state <> 'removed'
      AND ($2::text IS NULL OR ${column} = $2::text)`;
    const value =
      filter === null
        ? null
        : filter.attribute === 'userName'
          ? filter.value.toLowerCase()
          : filter.value;
    const total = await this.database.pool.query<{ count: string }>(
      `SELECT count(*) FROM organization_memberships m JOIN users u ON u.id = m.user_id
       WHERE ${where}`,
      [tenant.organizationId, value],
    );
    const page = await this.database.pool.query<MemberRow>(
      `${MEMBER_SELECT} WHERE ${where}
       ORDER BY m.joined_at, m.user_id OFFSET $3 LIMIT $4`,
      [tenant.organizationId, value, startIndex - 1, count],
    );
    return {
      schemas: [SCIM_LIST],
      totalResults: Number(total.rows[0]?.count ?? 0),
      startIndex,
      itemsPerPage: page.rows.length,
      Resources: page.rows.map(toUser),
    };
  }

  async get(tenant: ScimTenant, userId: string): Promise<ScimUser> {
    return toUser(await this.member(this.database.pool, tenant, userId));
  }

  /**
   * Adds a person: a new account (verified by the identity provider, with a
   * welcome email to choose a password) or an existing one. Someone who was
   * removed or suspended is brought back.
   */
  async create(
    tenant: ScimTenant,
    input: ScimUserInput,
    request: RequestMeta,
  ): Promise<ScimUser> {
    let welcome = false;
    const user = await this.database.transaction(async (client) => {
      const existing = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM users WHERE email_normalized = $1 FOR UPDATE`,
        [input.userName],
      );
      let userId = existing.rows[0]?.id;
      if (existing.rows[0] && existing.rows[0].status !== 'active')
        throw new ScimError(400, 'This account cannot be provisioned.');
      if (!userId) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO users (email_normalized, display_name, email_verified_at)
           VALUES ($1, $2, now()) RETURNING id`,
          [input.userName, displayNameOf(input)],
        );
        userId = created.rows[0]?.id;
        if (!userId) throw new Error('user insert returned no row');
        welcome = true;
      }
      const current = await client.query<{ state: string; role: string }>(
        `SELECT state, role FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2 FOR UPDATE`,
        [tenant.organizationId, userId],
      );
      const membership = current.rows[0];
      if (membership && membership.state !== 'removed')
        throw new ScimError(
          409,
          'This person is already a member.',
          'uniqueness',
        );
      await this.assertExternalIdFree(client, tenant, input.externalId, userId);
      const state = input.active ? 'active' : 'suspended';
      await client.query(
        `INSERT INTO organization_memberships
           (organization_id, user_id, role, state, scim_external_id)
         VALUES ($1, $2, 'member', $3, $4)
         ON CONFLICT (organization_id, user_id) DO UPDATE
           SET role = 'member', state = EXCLUDED.state,
               scim_external_id = EXCLUDED.scim_external_id,
               joined_at = now(), updated_at = now()`,
        [tenant.organizationId, userId, state, input.externalId ?? null],
      );
      await this.record(
        client,
        tenant,
        'org.member.provisioned',
        userId,
        request,
        {
          newAccount: welcome,
          active: input.active,
        },
      );
      return this.member(client, tenant, userId);
    });
    if (welcome && input.active)
      await this.auth.requestPasswordReset(input.userName, request, {
        organizationName: tenant.organizationName,
      });
    return toUser(user);
  }

  /** PUT: the membership state and external id; profile fields are ignored. */
  async replace(
    tenant: ScimTenant,
    userId: string,
    input: ScimUserInput,
    request: RequestMeta,
  ): Promise<ScimUser> {
    return this.change(tenant, userId, request, {
      active: input.active,
      externalId: input.externalId ?? null,
    });
  }

  /** PATCH: `active` and `externalId`, by path or in a value object. */
  async patch(
    tenant: ScimTenant,
    userId: string,
    operations: { op: string; path?: string | undefined; value?: unknown }[],
    request: RequestMeta,
  ): Promise<ScimUser> {
    const change: { active?: boolean; externalId?: string | null } = {};
    const apply = (path: string, value: unknown, remove: boolean) => {
      const key = path.toLowerCase();
      if (key === 'active') {
        const parsed = scimBoolean.safeParse(value);
        if (remove || !parsed.success)
          throw new ScimError(
            400,
            'active must be true or false.',
            'invalidValue',
          );
        change.active = parsed.data;
      } else if (key === 'externalid') {
        if (remove) change.externalId = null;
        else if (
          typeof value === 'string' &&
          value.trim() &&
          value.length <= 256
        )
          change.externalId = value.trim();
        else
          throw new ScimError(400, 'externalId is not valid.', 'invalidValue');
      }
      // Other attributes (names, emails, titles) belong to the account, not
      // to this organization, and are ignored.
    };
    for (const operation of operations) {
      const remove = operation.op === 'remove';
      if (operation.path) apply(operation.path, operation.value, remove);
      else if (
        !remove &&
        typeof operation.value === 'object' &&
        operation.value !== null
      )
        for (const [key, value] of Object.entries(operation.value))
          apply(key, value, false);
      else
        throw new ScimError(
          400,
          'The operation needs a path or value.',
          'noTarget',
        );
    }
    return this.change(tenant, userId, request, change);
  }

  /** DELETE: removes the person from the organization. */
  async remove(
    tenant: ScimTenant,
    userId: string,
    request: RequestMeta,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const row = await this.member(client, tenant, userId, true);
      this.assertManageable(row);
      await client.query(
        `UPDATE organization_memberships
         SET state = 'removed', scim_external_id = NULL, updated_at = now()
         WHERE organization_id = $1 AND user_id = $2`,
        [tenant.organizationId, userId],
      );
      await this.record(
        client,
        tenant,
        'org.member.deprovisioned',
        userId,
        request,
        {
          removed: true,
        },
      );
    });
  }

  private async change(
    tenant: ScimTenant,
    userId: string,
    request: RequestMeta,
    change: {
      active?: boolean | undefined;
      externalId?: string | null | undefined;
    },
  ): Promise<ScimUser> {
    const row = await this.database.transaction(async (client) => {
      const current = await this.member(client, tenant, userId, true);
      const state =
        change.active === undefined
          ? current.state
          : change.active
            ? 'active'
            : 'suspended';
      if (state !== current.state) this.assertManageable(current);
      if (change.externalId !== undefined)
        await this.assertExternalIdFree(
          client,
          tenant,
          change.externalId,
          userId,
        );
      await client.query(
        `UPDATE organization_memberships
         SET state = $3,
             scim_external_id = CASE WHEN $4 THEN $5::text ELSE scim_external_id END,
             updated_at = now()
         WHERE organization_id = $1 AND user_id = $2`,
        [
          tenant.organizationId,
          userId,
          state,
          change.externalId !== undefined,
          change.externalId ?? null,
        ],
      );
      if (state !== current.state)
        await this.record(
          client,
          tenant,
          state === 'active'
            ? 'org.member.reactivated'
            : 'org.member.deprovisioned',
          userId,
          request,
          { removed: false },
        );
      return this.member(client, tenant, userId);
    });
    return toUser(row);
  }

  /** Owners and admins are managed in Atlas, never by the directory. */
  private assertManageable(row: MemberRow): void {
    if (row.role === 'owner' || row.role === 'admin')
      throw new ScimError(
        403,
        'Owners and admins cannot be suspended or removed by provisioning.',
        'mutability',
      );
  }

  private async assertExternalIdFree(
    client: Pick<PoolClient, 'query'>,
    tenant: ScimTenant,
    externalId: string | null | undefined,
    userId: string,
  ): Promise<void> {
    if (!externalId) return;
    const taken = await client.query(
      `SELECT 1 FROM organization_memberships
       WHERE organization_id = $1 AND scim_external_id = $2 AND user_id <> $3`,
      [tenant.organizationId, externalId, userId],
    );
    if (taken.rowCount)
      throw new ScimError(409, 'externalId is already in use.', 'uniqueness');
  }

  private record(
    client: PoolClient,
    tenant: ScimTenant,
    action: AuditAction,
    userId: string,
    request: RequestMeta,
    metadata: Record<string, boolean>,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        organizationId: tenant.organizationId,
        target: { type: 'user', id: userId },
        metadata: { via: 'scim', ...metadata },
        request,
      },
      client,
    );
  }
}
