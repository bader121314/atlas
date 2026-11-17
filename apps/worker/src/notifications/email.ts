import type { Pool } from 'pg';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (message: MailMessage) => Promise<void>;

interface PendingRow {
  id: string;
  kind: 'task.assigned' | 'comment.created' | 'mention';
  email: string;
  recipient_name: string;
  actor_name: string | null;
  slug: string;
  project_key: string;
  number: number;
  title: string;
  email_enabled: boolean | null;
}

/** Plain-text email for one notification. */
export function composeEmail(row: PendingRow, webOrigin: string): MailMessage {
  const key = `${row.project_key}-${row.number}`;
  const who = row.actor_name ?? 'Someone';
  const link = `${webOrigin}/organizations/${row.slug}/projects/${row.project_key}/tasks/${row.number}`;
  const subject =
    row.kind === 'task.assigned'
      ? `${key} was assigned to you: ${row.title}`
      : row.kind === 'mention'
        ? `${who} mentioned you on ${key}: ${row.title}`
        : `New comment on ${key}: ${row.title}`;
  const opening =
    row.kind === 'task.assigned'
      ? `${who} assigned ${key} to you.`
      : row.kind === 'mention'
        ? `${who} mentioned you in a comment on ${key}.`
        : `${who} commented on ${key}.`;
  return {
    to: row.email,
    subject,
    text: `Hello ${row.recipient_name},\n\n${opening}\n\nOpen the task: ${link}\n\nYou can turn these emails off on your notifications page in Atlas.\n`,
  };
}

/**
 * Emails notifications that are still unread after `delayMs` (ADR-031), so
 * someone already looking at Atlas is not emailed as well. People who turned
 * email off, or read the notification first, are marked skipped. A failed
 * send leaves the row pending for the next run.
 */
export async function emailBatch(
  pool: Pool,
  send: SendMail,
  options: {
    delayMs: number;
    webOrigin: string;
    batchSize?: number;
    organizationId?: string;
  },
): Promise<{ sent: number; skipped: number }> {
  const client = await pool.connect();
  const result = { sent: 0, skipped: 0 };
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE notifications SET email_status = 'skipped'
       WHERE email_status = 'pending' AND read_at IS NOT NULL
         AND ($1::uuid IS NULL OR organization_id = $1)`,
      [options.organizationId ?? null],
    );
    const rows = await client.query<PendingRow>(
      `SELECT n.id, n.kind, u.email_normalized AS email, u.display_name AS recipient_name,
              a.display_name AS actor_name, o.slug, p.key AS project_key,
              t.number, t.title, s.email_enabled
       FROM notifications n
       JOIN users u ON u.id = n.recipient_user_id
       LEFT JOIN users a ON a.id = n.actor_user_id
       JOIN organizations o ON o.id = n.organization_id
       JOIN projects p ON p.id = n.project_id
       JOIN tasks t ON t.id = n.task_id
       LEFT JOIN notification_settings s
         ON s.organization_id = n.organization_id AND s.user_id = n.recipient_user_id
       WHERE n.email_status = 'pending' AND n.read_at IS NULL
         AND n.created_at <= now() - ($1 * interval '1 millisecond')
         AND ($3::uuid IS NULL OR n.organization_id = $3)
       ORDER BY n.created_at
       LIMIT $2
       FOR UPDATE OF n SKIP LOCKED`,
      [
        options.delayMs,
        options.batchSize ?? 50,
        options.organizationId ?? null,
      ],
    );
    for (const row of rows.rows) {
      if (row.email_enabled === false) {
        await client.query(
          `UPDATE notifications SET email_status = 'skipped' WHERE id = $1`,
          [row.id],
        );
        result.skipped += 1;
        continue;
      }
      try {
        await send(composeEmail(row, options.webOrigin));
      } catch {
        break;
      }
      await client.query(
        `UPDATE notifications SET email_status = 'sent' WHERE id = $1`,
        [row.id],
      );
      result.sent += 1;
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
