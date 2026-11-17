import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import type {
  CreateProjectRequest,
  Project,
  ProjectListResponse,
  ProjectMemberListResponse,
  UpdateProjectRequest,
} from '@atlas/contracts';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/audit.service';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { effectiveProjectRole } from './policy';
import type { ProjectRole } from './policy';

interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string;
  visibility: Project['visibility'];
  status: Project['status'];
  version: string;
  created_at: Date;
  updated_at: Date;
  explicit_role: string | null;
}

const PROJECT_COLUMNS = `p.id, p.key, p.name, p.description, p.visibility,
  p.status, p.version, p.created_at, p.updated_at`;

function toProject(row: ProjectRow, role: ProjectRole): Project {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    status: row.status,
    role,
    version: Number(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** All queries are bounded by the organization TenantGuard resolved. */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Resolves a project key to the caller's effective role, or undefined. */
  async resolve(
    tenant: TenantContext,
    userId: string,
    key: string,
  ): Promise<ProjectContext | undefined> {
    const result = await this.database.pool.query<{
      id: string;
      key: string;
      visibility: string;
      explicit_role: string | null;
      label_scope: string[] | null;
    }>(
      `SELECT p.id, p.key, p.visibility, pm.role AS explicit_role, pm.label_scope
       FROM projects p
       LEFT JOIN project_memberships pm
         ON pm.project_id = p.id AND pm.user_id = $3
       WHERE p.organization_id = $1 AND p.key = $2`,
      [tenant.organizationId, key, userId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const role = effectiveProjectRole(
      tenant.role,
      row.visibility,
      row.explicit_role ?? undefined,
    );
    if (!role) return undefined;
    // Label scopes only ever narrow guests (ADR-059).
    return tenant.role === 'guest' && row.label_scope
      ? { id: row.id, key: row.key, role, labelScope: row.label_scope }
      : { id: row.id, key: row.key, role };
  }

  async list(
    tenant: TenantContext,
    userId: string,
  ): Promise<ProjectListResponse> {
    const result = await this.database.pool.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS}, pm.role AS explicit_role
       FROM projects p
       LEFT JOIN project_memberships pm
         ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.organization_id = $1
       ORDER BY p.status, p.name
       LIMIT 500`,
      [tenant.organizationId, userId],
    );
    const projects: Project[] = [];
    for (const row of result.rows) {
      const role = effectiveProjectRole(
        tenant.role,
        row.visibility,
        row.explicit_role ?? undefined,
      );
      if (role) projects.push(toProject(row, role));
    }
    return { projects };
  }

  async get(tenant: TenantContext, project: ProjectContext): Promise<Project> {
    const result = await this.database.pool.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS}, NULL AS explicit_role
       FROM projects p WHERE p.organization_id = $1 AND p.id = $2`,
      [tenant.organizationId, project.id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return toProject(row, project.role);
  }

  async create(
    tenant: TenantContext,
    userId: string,
    input: CreateProjectRequest,
    request: RequestMeta,
  ): Promise<Project> {
    try {
      return await this.database.transaction(async (client) => {
        const created = await client.query<ProjectRow>(
          `INSERT INTO projects (organization_id, key, name, description,
             visibility, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${PROJECT_COLUMNS.replaceAll('p.', '')},
             NULL AS explicit_role`,
          [
            tenant.organizationId,
            input.key,
            input.name,
            input.description,
            input.visibility,
            userId,
          ],
        );
        const row = created.rows[0];
        if (!row) throw new Error('project insert returned no row');
        await client.query(
          `INSERT INTO workflow_states (organization_id, project_id, key, label, category, position)
           SELECT $1, $2, s.key, s.label, s.category, s.position
           FROM (VALUES
             ('todo', 'To do', 'todo', 1),
             ('in_progress', 'In progress', 'in_progress', 2),
             ('done', 'Done', 'done', 3)
           ) AS s (key, label, category, position)`,
          [tenant.organizationId, row.id],
        );
        // The creator manages the project, including private ones.
        await client.query(
          `INSERT INTO project_memberships (organization_id, project_id, user_id, role)
           VALUES ($1, $2, $3, 'manager')`,
          [tenant.organizationId, row.id, userId],
        );
        await this.audit.record(
          {
            action: 'project.created',
            actorUserId: userId,
            organizationId: tenant.organizationId,
            target: { type: 'project', id: row.id },
            metadata: { key: row.key, visibility: row.visibility },
            request,
          },
          client,
        );
        return toProject(row, 'manager');
      });
    } catch (error) {
      if (
        error instanceof DatabaseError &&
        error.constraint === 'projects_organization_id_key_key'
      ) {
        throw new ConflictException();
      }
      throw error;
    }
  }

  /**
   * Optimistic concurrency: the caller sends the version it last saw; a
   * stale version returns 409 instead of silently overwriting.
   */
  async update(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    input: UpdateProjectRequest,
    request: RequestMeta,
  ): Promise<Project> {
    const fields = (
      ['name', 'description', 'visibility', 'status'] as const
    ).filter((field) => input[field] !== undefined);
    return this.database.transaction(async (client) => {
      const updated = await client.query<ProjectRow>(
        `UPDATE projects p SET
           name = COALESCE($4, p.name),
           description = COALESCE($5, p.description),
           visibility = COALESCE($6, p.visibility),
           status = COALESCE($7, p.status),
           version = p.version + 1,
           updated_at = now()
         WHERE p.organization_id = $1 AND p.id = $2 AND p.version = $3
         RETURNING ${PROJECT_COLUMNS}, NULL AS explicit_role`,
        [
          tenant.organizationId,
          project.id,
          input.version,
          input.name ?? null,
          input.description ?? null,
          input.visibility ?? null,
          input.status ?? null,
        ],
      );
      const row = updated.rows[0];
      if (!row) throw new ConflictException();
      await this.audit.record(
        {
          action: 'project.updated',
          actorUserId: userId,
          organizationId: tenant.organizationId,
          target: { type: 'project', id: project.id },
          metadata: { fields: fields.join(',') },
          request,
        },
        client,
      );
      return toProject(row, project.role);
    });
  }

  async listMembers(
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<ProjectMemberListResponse> {
    const result = await this.database.pool.query<{
      user_id: string;
      display_name: string;
      role: ProjectRole;
      label_scope: string[] | null;
    }>(
      `SELECT pm.user_id, u.display_name, pm.role, pm.label_scope
       FROM project_memberships pm
       JOIN organization_memberships om
         ON om.organization_id = pm.organization_id
        AND om.user_id = pm.user_id AND om.state = 'active'
       JOIN users u ON u.id = pm.user_id
       WHERE pm.organization_id = $1 AND pm.project_id = $2
       ORDER BY u.display_name
       LIMIT 500`,
      [tenant.organizationId, project.id],
    );
    return {
      members: result.rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        role: row.role,
        labelIds: row.label_scope,
      })),
    };
  }

  async setMember(
    tenant: TenantContext,
    project: ProjectContext,
    actorUserId: string,
    targetUserId: string,
    role: ProjectRole,
    request: RequestMeta,
    labelIds?: string[] | null,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const member = await client.query<{ role: string }>(
        `SELECT role FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2 AND state = 'active'`,
        [tenant.organizationId, targetUserId],
      );
      const organizationRole = member.rows[0]?.role;
      if (!organizationRole) throw new NotFoundException();
      // Guests can read or comment, never edit (docs/05).
      if (
        organizationRole === 'guest' &&
        (role === 'editor' || role === 'manager')
      ) {
        throw new BadRequestException();
      }
      if (labelIds) {
        // Only guests can be scoped, and only to this organization's labels.
        if (organizationRole !== 'guest') throw new BadRequestException();
        const known = await client.query<{ count: string }>(
          'SELECT count(*) FROM labels WHERE organization_id = $1 AND id = ANY($2::uuid[])',
          [tenant.organizationId, labelIds],
        );
        if (Number(known.rows[0]?.count) !== labelIds.length)
          throw new BadRequestException();
      }
      await client.query(
        `INSERT INTO project_memberships (organization_id, project_id, user_id, role, label_scope)
         VALUES ($1, $2, $3, $4, $6::uuid[])
         ON CONFLICT (project_id, user_id)
         DO UPDATE SET role = EXCLUDED.role,
           label_scope = CASE WHEN $5 THEN $6::uuid[] ELSE project_memberships.label_scope END,
           updated_at = now()`,
        [
          tenant.organizationId,
          project.id,
          targetUserId,
          role,
          labelIds !== undefined,
          labelIds ?? null,
        ],
      );
      await this.audit.record(
        {
          action: 'project.member.set',
          actorUserId,
          organizationId: tenant.organizationId,
          target: { type: 'project', id: project.id },
          metadata: {
            userId: targetUserId,
            role,
            labelScope:
              labelIds === undefined
                ? 'unchanged'
                : labelIds === null
                  ? 'none'
                  : labelIds.length,
          },
          request,
        },
        client,
      );
    });
  }

  async removeMember(
    tenant: TenantContext,
    project: ProjectContext,
    actorUserId: string,
    targetUserId: string,
    request: RequestMeta,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const removed = await client.query(
        `DELETE FROM project_memberships
         WHERE organization_id = $1 AND project_id = $2 AND user_id = $3`,
        [tenant.organizationId, project.id, targetUserId],
      );
      if (removed.rowCount !== 1) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'project.member.removed',
          actorUserId,
          organizationId: tenant.organizationId,
          target: { type: 'project', id: project.id },
          metadata: { userId: targetUserId },
          request,
        },
        client,
      );
    });
  }
}
