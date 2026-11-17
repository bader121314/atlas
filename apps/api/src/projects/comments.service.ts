import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Activity, Comment } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { ActivityService } from './activity.service';

interface CommentRow {
  id: string;
  author_user_id: string;
  author_name: string;
  body: string;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
}

function toComment(row: CommentRow): Comment {
  const deleted = row.deleted_at !== null;
  return {
    id: row.id,
    author: { userId: row.author_user_id, displayName: row.author_name },
    // Deleted comments keep their place in the thread but not their text.
    body: deleted ? null : row.body,
    createdAt: row.created_at.toISOString(),
    editedAt: row.edited_at?.toISOString() ?? null,
    deleted,
  };
}

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  /** Resolves a task number to its id inside the project, or 404. */
  private async taskId(
    runner: Pick<PoolClient, 'query'>,
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<{ id: string; version: number }> {
    const result = await runner.query<{ id: string; version: string }>(
      `SELECT id, version FROM tasks
       WHERE organization_id = $1 AND project_id = $2 AND number = $3`,
      [tenant.organizationId, project.id, number],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return { id: row.id, version: Number(row.version) };
  }

  async list(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<Comment[]> {
    const task = await this.taskId(this.database.pool, tenant, project, number);
    const result = await this.database.pool.query<CommentRow>(
      `SELECT c.id, c.author_user_id, u.display_name AS author_name, c.body,
         c.created_at, c.edited_at, c.deleted_at
       FROM task_comments c JOIN users u ON u.id = c.author_user_id
       WHERE c.organization_id = $1 AND c.task_id = $2
       ORDER BY c.created_at, c.id
       LIMIT 500`,
      [tenant.organizationId, task.id],
    );
    return result.rows.map(toComment);
  }

  async create(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    userId: string,
    body: string,
    mentions: string[] = [],
  ): Promise<Comment> {
    return this.database.transaction(async (client) => {
      const task = await this.taskId(client, tenant, project, number);
      if (mentions.length > 0) {
        // Only people who can open this project can be mentioned.
        const allowed = await client.query<{ count: string }>(
          `SELECT count(*) FROM organization_memberships m
           JOIN projects p ON p.organization_id = m.organization_id AND p.id = $2
           LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = m.user_id
           WHERE m.organization_id = $1 AND m.user_id = ANY($3::uuid[]) AND m.state = 'active'
             AND (m.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL
                  OR (m.role = 'member' AND p.visibility = 'organization'))`,
          [tenant.organizationId, project.id, mentions],
        );
        if (Number(allowed.rows[0]?.count) !== mentions.length)
          throw new BadRequestException(
            'Someone mentioned cannot open this project',
          );
      }
      const inserted = await client.query<CommentRow>(
        `WITH c AS (
           INSERT INTO task_comments (organization_id, task_id, author_user_id, body)
           VALUES ($1, $2, $3, $4)
           RETURNING id, author_user_id, body, created_at, edited_at, deleted_at)
         SELECT c.*, u.display_name AS author_name
         FROM c JOIN users u ON u.id = c.author_user_id`,
        [tenant.organizationId, task.id, userId, body],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('comment insert returned no row');
      await this.activity.record(client, {
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: task.id,
        actorUserId: userId,
        action: 'comment.created',
        changes: { commentId: row.id },
        aggregateVersion: task.version,
        mentions,
      });
      return toComment(row);
    });
  }

  /**
   * Authors may edit their own comments; authors and project managers may
   * delete. Deletion is soft so the thread stays readable.
   */
  async change(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    commentId: string,
    userId: string,
    body: string | null,
  ): Promise<Comment> {
    return this.database.transaction(async (client) => {
      const task = await this.taskId(client, tenant, project, number);
      const found = await client.query<{
        author_user_id: string;
        deleted_at: Date | null;
      }>(
        `SELECT author_user_id, deleted_at FROM task_comments
         WHERE organization_id = $1 AND task_id = $2 AND id = $3
         FOR UPDATE`,
        [tenant.organizationId, task.id, commentId],
      );
      const comment = found.rows[0];
      if (!comment || comment.deleted_at) throw new NotFoundException();
      const own = comment.author_user_id === userId;
      const allowed = body === null ? own || project.role === 'manager' : own;
      if (!allowed) throw new ForbiddenException();
      const updated = await client.query<CommentRow>(
        `WITH c AS (
           UPDATE task_comments SET
             body = COALESCE($4, body),
             edited_at = CASE WHEN $4::text IS NULL THEN edited_at ELSE now() END,
             deleted_at = CASE WHEN $4::text IS NULL THEN now() ELSE deleted_at END
           WHERE organization_id = $1 AND task_id = $2 AND id = $3
           RETURNING id, author_user_id, body, created_at, edited_at, deleted_at)
         SELECT c.*, u.display_name AS author_name
         FROM c JOIN users u ON u.id = c.author_user_id`,
        [tenant.organizationId, task.id, commentId, body],
      );
      const row = updated.rows[0];
      if (!row) throw new NotFoundException();
      await this.activity.record(client, {
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: task.id,
        actorUserId: userId,
        action: body === null ? 'comment.deleted' : 'comment.edited',
        changes: { commentId },
        aggregateVersion: task.version,
      });
      return toComment(row);
    });
  }

  async history(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<Activity[]> {
    const task = await this.taskId(this.database.pool, tenant, project, number);
    const result = await this.database.pool.query<{
      id: string;
      action: string;
      actor_user_id: string;
      actor_name: string;
      changes: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `SELECT a.id, a.action, a.actor_user_id, u.display_name AS actor_name,
         a.changes, a.occurred_at
       FROM activity_events a JOIN users u ON u.id = a.actor_user_id
       WHERE a.organization_id = $1 AND a.task_id = $2
       ORDER BY a.occurred_at, a.id
       LIMIT 500`,
      [tenant.organizationId, task.id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor: { userId: row.actor_user_id, displayName: row.actor_name },
      changes: row.changes,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }
}
