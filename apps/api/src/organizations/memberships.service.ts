import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { PoolClient } from 'pg';
import { parseAuthEnvironment } from '@atlas/config';
import type {
  CreateInvitationRequest,
  Invitation,
  InvitationListResponse,
  Organization,
} from '@atlas/contracts';
import { digestToken, generateToken } from '@atlas/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import { Mailer } from '../auth/mailer';
import type { AuthContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { canChangeRole, canInviteAs, canRemove } from './policy';

const INVITATION_TTL = '7 days';

function isLastOwnerViolation(error: unknown): boolean {
  return (
    error instanceof DatabaseError &&
    error.constraint === 'organizations_active_owner_check'
  );
}

/**
 * Invitations and membership changes. Authorization has two layers: the
 * route permission checked by TenantGuard, then role-specific rules here
 * (admins cannot create, change or remove admins or owners). The database
 * still enforces the last-owner rule and same-organization inviters.
 */
@Injectable()
export class MembershipsService {
  private readonly logger = new Logger('Memberships');

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Mailer) private readonly mailer: Mailer,
  ) {}

  private secret(): string {
    return parseAuthEnvironment(process.env).SESSION_SECRET;
  }

  async invite(
    tenant: TenantContext,
    actor: AuthContext,
    input: CreateInvitationRequest,
    request: RequestMeta,
  ): Promise<Invitation> {
    if (!canInviteAs(tenant.role, input.role)) throw new ForbiddenException();
    const token = generateToken();
    const invitation = await this.database.transaction(async (client) => {
      const existing = await client.query(
        `SELECT 1 FROM organization_memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND u.email_normalized = $2
           AND m.state = 'active'`,
        [tenant.organizationId, input.email],
      );
      if (existing.rowCount) throw new ConflictException();
      // One outstanding invitation per email (ADR-010): replace, not stack.
      await client.query(
        `UPDATE invitations SET revoked_at = now()
         WHERE organization_id = $1 AND email_normalized = $2
           AND accepted_at IS NULL AND revoked_at IS NULL`,
        [tenant.organizationId, input.email],
      );
      const created = await client.query<{
        id: string;
        created_at: Date;
        expires_at: Date;
      }>(
        `INSERT INTO invitations (organization_id, email_normalized,
           invited_by_user_id, role, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + $6::interval)
         RETURNING id, created_at, expires_at`,
        [
          tenant.organizationId,
          input.email,
          actor.user.id,
          input.role,
          digestToken(token, this.secret()),
          INVITATION_TTL,
        ],
      );
      const row = created.rows[0];
      if (!row) throw new Error('invitation insert returned no row');
      await this.audit.record(
        {
          action: 'org.invitation.created',
          actorUserId: actor.user.id,
          organizationId: tenant.organizationId,
          target: { type: 'invitation', id: row.id },
          metadata: { role: input.role },
          request,
        },
        client,
      );
      return {
        id: row.id,
        email: input.email,
        role: input.role,
        invitedBy: actor.user.displayName,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      };
    });
    const origin = parseAuthEnvironment(process.env).WEB_ORIGIN;
    try {
      await this.mailer.send({
        to: input.email,
        subject: `You're invited to join ${tenant.slug} on Atlas`,
        text: `${actor.user.displayName} invited you to join the "${tenant.slug}" organization on Atlas as ${input.role}.\n\nSign in with this email address, then accept here:\n\n${origin}/invitations/accept?token=${token}\n\nThis invitation expires in 7 days.`,
      });
    } catch {
      this.logger.error('invitation email could not be sent');
    }
    return invitation;
  }

  async listInvitations(
    tenant: TenantContext,
  ): Promise<InvitationListResponse> {
    const result = await this.database.pool.query<{
      id: string;
      email_normalized: string;
      role: Invitation['role'];
      inviter: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `SELECT i.id, i.email_normalized, i.role, u.display_name AS inviter,
         i.created_at, i.expires_at
       FROM invitations i JOIN users u ON u.id = i.invited_by_user_id
       WHERE i.organization_id = $1
         AND i.accepted_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > now()
       ORDER BY i.created_at DESC
       LIMIT 200`,
      [tenant.organizationId],
    );
    return {
      invitations: result.rows.map((row) => ({
        id: row.id,
        email: row.email_normalized,
        role: row.role,
        invitedBy: row.inviter,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      })),
    };
  }

  async revokeInvitation(
    tenant: TenantContext,
    actor: AuthContext,
    invitationId: string,
    request: RequestMeta,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ role: string }>(
        `UPDATE invitations SET revoked_at = now()
         WHERE id = $1 AND organization_id = $2
           AND accepted_at IS NULL AND revoked_at IS NULL
         RETURNING role`,
        [invitationId, tenant.organizationId],
      );
      const role = result.rows[0]?.role;
      if (!role) throw new NotFoundException();
      // Admins may only manage invitations they could have created.
      if (!canInviteAs(tenant.role, role)) throw new ForbiddenException();
      await this.audit.record(
        {
          action: 'org.invitation.revoked',
          actorUserId: actor.user.id,
          organizationId: tenant.organizationId,
          target: { type: 'invitation', id: invitationId },
          request,
        },
        client,
      );
    });
  }

  /**
   * Accepts an invitation for the signed-in user. The account email must
   * match the invited email. Every invalid case (unknown, expired, used,
   * revoked, or for someone else) returns the same 400.
   */
  async accept(
    actor: AuthContext,
    token: string,
    request: RequestMeta,
  ): Promise<Organization> {
    return this.database.transaction(async (client) => {
      const found = await client.query<{
        id: string;
        organization_id: string;
        role: Organization['role'];
      }>(
        `SELECT i.id, i.organization_id, i.role
         FROM invitations i
         JOIN organizations o ON o.id = i.organization_id
         WHERE i.token_hash = $1 AND i.email_normalized = $2
           AND i.accepted_at IS NULL AND i.revoked_at IS NULL
           AND i.expires_at > now() AND o.status = 'active'
         FOR UPDATE OF i`,
        [digestToken(token, this.secret()), actor.user.email],
      );
      const invitation = found.rows[0];
      if (!invitation) throw new BadRequestException();
      const current = await client.query<{ state: string }>(
        `SELECT state FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2 FOR UPDATE`,
        [invitation.organization_id, actor.user.id],
      );
      const state = current.rows[0]?.state;
      // Already active: nothing to accept. Suspended members are not
      // reinstated by an invitation; an owner or admin must decide that.
      if (state === 'active' || state === 'suspended') {
        throw new ConflictException();
      }
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, user_id) DO UPDATE
           SET role = EXCLUDED.role, state = 'active',
               joined_at = now(), updated_at = now()`,
        [invitation.organization_id, actor.user.id, invitation.role],
      );
      await client.query(
        'UPDATE invitations SET accepted_at = now() WHERE id = $1',
        [invitation.id],
      );
      await this.audit.record(
        {
          action: 'org.member.joined',
          actorUserId: actor.user.id,
          organizationId: invitation.organization_id,
          target: { type: 'invitation', id: invitation.id },
          metadata: { role: invitation.role },
          request,
        },
        client,
      );
      const organization = await client.query<{
        id: string;
        slug: string;
        name: string;
        created_at: Date;
      }>('SELECT id, slug, name, created_at FROM organizations WHERE id = $1', [
        invitation.organization_id,
      ]);
      const row = organization.rows[0];
      if (!row) throw new Error('organization vanished during accept');
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        role: invitation.role,
        createdAt: row.created_at.toISOString(),
      };
    });
  }

  /** Locks and returns the target's active role, or 404 if not a member. */
  private async targetRole(
    client: PoolClient,
    tenant: TenantContext,
    userId: string,
  ): Promise<string> {
    const result = await client.query<{ role: string }>(
      `SELECT role FROM organization_memberships
       WHERE organization_id = $1 AND user_id = $2 AND state = 'active'
       FOR UPDATE`,
      [tenant.organizationId, userId],
    );
    const role = result.rows[0]?.role;
    if (!role) throw new NotFoundException();
    return role;
  }

  /**
   * Changes a member's role. Ownership transfer is "promote the new owner,
   * then demote yourself"; the deferred trigger keeps at least one owner and
   * a change that would leave none returns 409.
   */
  async changeRole(
    tenant: TenantContext,
    actor: AuthContext,
    targetUserId: string,
    role: string,
    request: RequestMeta,
  ): Promise<void> {
    try {
      await this.database.transaction(async (client) => {
        const current = await this.targetRole(client, tenant, targetUserId);
        if (!canChangeRole(tenant.role, current, role)) {
          throw new ForbiddenException();
        }
        if (current === role) return;
        await client.query(
          `UPDATE organization_memberships SET role = $3, updated_at = now()
           WHERE organization_id = $1 AND user_id = $2`,
          [tenant.organizationId, targetUserId, role],
        );
        await this.audit.record(
          {
            action: 'org.member.role_changed',
            actorUserId: actor.user.id,
            organizationId: tenant.organizationId,
            target: { type: 'user', id: targetUserId },
            metadata: { from: current, to: role },
            request,
          },
          client,
        );
      });
    } catch (error) {
      if (isLastOwnerViolation(error)) throw new ConflictException();
      throw error;
    }
  }

  /** Removes a member, or lets the caller leave. Access ends immediately. */
  async remove(
    tenant: TenantContext,
    actor: AuthContext,
    targetUserId: string,
    request: RequestMeta,
  ): Promise<void> {
    const self = targetUserId === actor.user.id;
    try {
      await this.database.transaction(async (client) => {
        const current = await this.targetRole(client, tenant, targetUserId);
        if (!canRemove(tenant.role, current, self)) {
          throw new ForbiddenException();
        }
        await client.query(
          `UPDATE organization_memberships
           SET state = 'removed', updated_at = now()
           WHERE organization_id = $1 AND user_id = $2`,
          [tenant.organizationId, targetUserId],
        );
        await this.audit.record(
          {
            action: self ? 'org.member.left' : 'org.member.removed',
            actorUserId: actor.user.id,
            organizationId: tenant.organizationId,
            target: { type: 'user', id: targetUserId },
            metadata: { role: current },
            request,
          },
          client,
        );
      });
    } catch (error) {
      if (isLastOwnerViolation(error)) throw new ConflictException();
      throw error;
    }
  }
}
