import { Inject, Injectable } from '@nestjs/common';
import type { Notification, NotificationSettings } from '@atlas/contracts';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

// Only notifications about projects the caller can read today are shown, so
// losing access to a private project also hides its notifications.
const VISIBLE = `n.organization_id = $1 AND n.recipient_user_id = $2
  AND ($3 IN ('owner', 'admin') OR pm.user_id IS NOT NULL
       OR ($3 = 'member' AND p.visibility = 'organization'))`;

const FROM = `FROM notifications n
  JOIN projects p ON p.id = n.project_id
  LEFT JOIN project_memberships pm
    ON pm.project_id = p.id AND pm.user_id = n.recipient_user_id`;

/** The caller's notification inbox and settings (ADR-031). */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(
    tenant: TenantContext,
    userId: string,
    unreadOnly: boolean,
  ): Promise<Notification[]> {
    const result = await this.database.pool.query<{
      id: string;
      kind: Notification['kind'];
      actor: string | null;
      project_key: string;
      number: number;
      title: string;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT n.id, n.kind, a.display_name AS actor, p.key AS project_key,
              t.number, t.title, n.created_at, n.read_at
       ${FROM}
       JOIN tasks t ON t.id = n.task_id
       LEFT JOIN users a ON a.id = n.actor_user_id
       WHERE ${VISIBLE} AND ($4::boolean IS FALSE OR n.read_at IS NULL)
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 50`,
      [tenant.organizationId, userId, tenant.role, unreadOnly],
    );
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      actor: row.actor,
      task: {
        key: `${row.project_key}-${row.number}`,
        projectKey: row.project_key,
        number: row.number,
        title: row.title,
      },
      createdAt: row.created_at.toISOString(),
      readAt: row.read_at?.toISOString() ?? null,
    }));
  }

  async unreadCount(tenant: TenantContext, userId: string): Promise<number> {
    const result = await this.database.pool.query<{ count: string }>(
      `SELECT count(*) ${FROM} WHERE ${VISIBLE} AND n.read_at IS NULL`,
      [tenant.organizationId, userId, tenant.role],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** Marks the given notifications (or all) read; others' ids are ignored. */
  async markRead(
    tenant: TenantContext,
    userId: string,
    ids: string[] | 'all',
  ): Promise<void> {
    await this.database.pool.query(
      `UPDATE notifications SET read_at = now()
       WHERE organization_id = $1 AND recipient_user_id = $2 AND read_at IS NULL
         AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))`,
      [tenant.organizationId, userId, ids === 'all' ? null : ids],
    );
  }

  async settings(
    tenant: TenantContext,
    userId: string,
  ): Promise<NotificationSettings> {
    const result = await this.database.pool.query<{ email_enabled: boolean }>(
      `SELECT email_enabled FROM notification_settings
       WHERE organization_id = $1 AND user_id = $2`,
      [tenant.organizationId, userId],
    );
    return { email: result.rows[0]?.email_enabled ?? true };
  }

  async updateSettings(
    tenant: TenantContext,
    userId: string,
    input: NotificationSettings,
  ): Promise<NotificationSettings> {
    await this.database.pool.query(
      `INSERT INTO notification_settings (organization_id, user_id, email_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id)
       DO UPDATE SET email_enabled = EXCLUDED.email_enabled, updated_at = now()`,
      [tenant.organizationId, userId, input.email],
    );
    return input;
  }
}
