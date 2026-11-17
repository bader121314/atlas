import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ShareLink, SharedProject } from '@atlas/contracts';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

const MAX_LINKS = 10;
const MAX_TASKS = 500;

interface LinkRow {
  id: string;
  prefix: string;
  created_by_user_id: string;
  display_name: string;
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
}

const LINK_COLUMNS = `l.id, l.prefix, l.created_by_user_id, u.display_name,
  l.created_at, l.expires_at, l.last_used_at`;

function toLink(row: LinkRow): ShareLink {
  return {
    id: row.id,
    prefix: row.prefix,
    createdBy: {
      userId: row.created_by_user_id,
      displayName: row.display_name,
    },
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}

/**
 * Public read-only links to a project's task list (ADR-050). A link works
 * only while it is unexpired and unrevoked, the project is active, and the
 * person who made it could still make it.
 */
@Injectable()
export class SharesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<ShareLink[]> {
    const result = await this.database.pool.query<LinkRow>(
      `SELECT ${LINK_COLUMNS}
       FROM share_links l JOIN users u ON u.id = l.created_by_user_id
       WHERE l.organization_id = $1 AND l.project_id = $2
         AND l.revoked_at IS NULL AND l.expires_at > now()
       ORDER BY l.created_at DESC`,
      [tenant.organizationId, project.id],
    );
    return result.rows.map(toLink);
  }

  /** Creates a link; the token is returned this once only. */
  async create(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    expiresInDays: number,
    request: RequestMeta,
  ): Promise<{ link: ShareLink; token: string } | undefined> {
    const token = `ats_${randomBytes(32).toString('base64url')}`;
    return this.database.transaction(async (client) => {
      // Serialize creation per project so the cap holds under concurrency.
      await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [
        project.id,
      ]);
      const count = await client.query<{ count: string }>(
        `SELECT count(*) FROM share_links
         WHERE organization_id = $1 AND project_id = $2
           AND revoked_at IS NULL AND expires_at > now()`,
        [tenant.organizationId, project.id],
      );
      if (Number(count.rows[0]?.count) >= MAX_LINKS) return undefined;
      const result = await client.query<LinkRow>(
        `WITH l AS (
           INSERT INTO share_links (organization_id, project_id, created_by_user_id,
             prefix, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 day'))
           RETURNING *)
         SELECT ${LINK_COLUMNS} FROM l JOIN users u ON u.id = l.created_by_user_id`,
        [
          tenant.organizationId,
          project.id,
          userId,
          token.slice(0, 10),
          this.auth.tokenDigest(token),
          expiresInDays,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('share link insert returned no row');
      await this.audit.record(
        {
          action: 'share_link.created',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'share_link', id: row.id },
          metadata: { project: project.key, expiresInDays },
          request,
        },
        client,
      );
      return { link: toLink(row), token };
    });
  }

  async revoke(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    id: string,
    request: RequestMeta,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query(
        `UPDATE share_links SET revoked_at = now()
         WHERE organization_id = $1 AND project_id = $2 AND id = $3
           AND revoked_at IS NULL`,
        [tenant.organizationId, project.id, id],
      );
      if (result.rowCount !== 1) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'share_link.revoked',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'share_link', id },
          metadata: { project: project.key },
          request,
        },
        client,
      );
    });
  }

  /** What anyone holding the token sees, or undefined (always a 404). */
  async resolve(token: string): Promise<SharedProject | undefined> {
    const link = await this.database.pool.query<{
      id: string;
      organization_id: string;
      project_id: string;
      key: string;
      name: string;
      expires_at: Date;
    }>(
      `SELECT l.id, l.organization_id, l.project_id, p.key, p.name, l.expires_at
       FROM share_links l
       JOIN projects p ON p.organization_id = l.organization_id AND p.id = l.project_id
       JOIN organization_memberships m
         ON m.organization_id = l.organization_id AND m.user_id = l.created_by_user_id
       LEFT JOIN project_memberships pm
         ON pm.project_id = l.project_id AND pm.user_id = l.created_by_user_id
       WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND l.expires_at > now()
         AND p.status = 'active' AND m.state = 'active'
         -- The creator must still manage the project (ADR-018 roles).
         AND (m.role IN ('owner', 'admin')
              OR (m.role = 'member' AND pm.role = 'manager'))`,
      [this.auth.tokenDigest(token)],
    );
    const row = link.rows[0];
    if (!row) return undefined;
    const tasks = await this.database.pool.query<{
      number: number;
      title: string;
      state: string;
      category: 'todo' | 'in_progress' | 'done';
      priority: string;
      due_on: string | null;
    }>(
      `SELECT t.number, t.title, s.label AS state, s.category, t.priority,
         to_char(t.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS due_on
       FROM tasks t JOIN workflow_states s ON s.id = t.state_id
       WHERE t.organization_id = $1 AND t.project_id = $2
       ORDER BY s.position, t.number
       LIMIT $3`,
      [row.organization_id, row.project_id, MAX_TASKS + 1],
    );
    // Recorded at most once a minute so popular links do not write per view.
    await this.database.pool.query(
      `UPDATE share_links SET last_used_at = now()
       WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
      [row.id],
    );
    return {
      project: { key: row.key, name: row.name },
      tasks: tasks.rows.slice(0, MAX_TASKS).map((t) => ({
        number: t.number,
        title: t.title,
        state: t.state,
        category: t.category,
        priority: t.priority,
        dueOn: t.due_on,
      })),
      truncated: tasks.rows.length > MAX_TASKS,
      expiresAt: row.expires_at.toISOString(),
    };
  }
}
