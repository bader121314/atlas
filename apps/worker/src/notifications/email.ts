import type { Pool } from 'pg';
import { message, messageLocale } from '@atlas/shared';
import { countUsage } from '../usage';

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
  email_mode: 'instant' | 'daily' | 'off' | null;
  /** The recipient's language (ADR-066); English when absent. */
  locale?: string;
}

/** Plain-text email for one notification, in the recipient's language. */
export function composeEmail(row: PendingRow, webOrigin: string): MailMessage {
  const locale = messageLocale(row.locale);
  const key = `${row.project_key}-${row.number}`;
  const who = row.actor_name ?? message(locale, 'someone');
  const link = `${webOrigin}/organizations/${row.slug}/projects/${row.project_key}/tasks/${row.number}`;
  const kind =
    row.kind === 'task.assigned'
      ? 'assigned'
      : row.kind === 'mention'
        ? 'mention'
        : 'comment';
  const vars = { key, who, title: row.title };
  return {
    to: row.email,
    subject: message(locale, `${kind}.subject` as const, vars),
    text: message(locale, 'notification.text', {
      name: row.recipient_name,
      opening: message(locale, `${kind}.opening` as const, vars),
      link,
    }),
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
    const rows = await client.query<PendingRow & { organization_id: string }>(
      `SELECT n.id, n.organization_id, n.kind, u.email_normalized AS email, u.display_name AS recipient_name, u.locale,
              a.display_name AS actor_name, o.slug, p.key AS project_key,
              t.number, t.title, s.email_mode
       FROM notifications n
       JOIN users u ON u.id = n.recipient_user_id
       LEFT JOIN users a ON a.id = n.actor_user_id
       JOIN organizations o ON o.id = n.organization_id
       JOIN projects p ON p.id = n.project_id
       JOIN tasks t ON t.id = n.task_id
       LEFT JOIN notification_settings s
         ON s.organization_id = n.organization_id AND s.user_id = n.recipient_user_id
       WHERE n.email_status = 'pending' AND n.read_at IS NULL
         -- Daily-digest people are emailed by digestBatch instead.
         AND COALESCE(s.email_mode, 'instant') <> 'daily'
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
      if (row.email_mode === 'off') {
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
      await countUsage(client, row.organization_id, 'notification_emails');
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

interface DigestItem {
  kind: 'task.assigned' | 'comment.created' | 'mention';
  actor_name: string | null;
  project_key: string;
  number: number;
  title: string;
}

/** One email summarizing a person's unread notifications. */
export function composeDigest(
  recipient: { email: string; name: string; slug: string; locale?: string },
  items: DigestItem[],
  webOrigin: string,
): MailMessage {
  const locale = messageLocale(recipient.locale);
  const lines = items.map((i) => {
    const key = `${i.project_key}-${i.number}`;
    const who = i.actor_name ?? message(locale, 'someone');
    const kind =
      i.kind === 'task.assigned'
        ? 'assigned'
        : i.kind === 'mention'
          ? 'mention'
          : 'comment';
    return `- ${key} ${i.title}: ${message(locale, `${kind}.line` as const, { who })}`;
  });
  return {
    to: recipient.email,
    subject:
      items.length === 1
        ? message(locale, 'digest.subject.one')
        : message(locale, 'digest.subject.many', { count: items.length }),
    text: message(locale, 'digest.text', {
      name: recipient.name,
      lines: lines.join('\n'),
      link: `${webOrigin}/organizations/${recipient.slug}/notifications`,
    }),
  };
}

/**
 * Daily digests (ADR-048): people who chose them get at most one email per
 * 24 hours listing their unread notifications, which are then marked sent.
 */
export async function digestBatch(
  pool: Pool,
  send: SendMail,
  options: { webOrigin: string; organizationId?: string; maxItems?: number },
): Promise<number> {
  const client = await pool.connect();
  let sent = 0;
  try {
    await client.query('BEGIN');
    const people = await client.query<{
      organization_id: string;
      user_id: string;
      email: string;
      name: string;
      slug: string;
      locale: string;
    }>(
      `SELECT s.organization_id, s.user_id, u.email_normalized AS email,
              u.display_name AS name, o.slug, u.locale
       FROM notification_settings s
       JOIN users u ON u.id = s.user_id
       JOIN organizations o ON o.id = s.organization_id
       WHERE s.email_mode = 'daily'
         AND (s.last_digest_at IS NULL OR s.last_digest_at <= now() - interval '24 hours')
         AND ($1::uuid IS NULL OR s.organization_id = $1)
         AND EXISTS (SELECT 1 FROM notifications n WHERE n.organization_id = s.organization_id
           AND n.recipient_user_id = s.user_id AND n.email_status = 'pending' AND n.read_at IS NULL)
       LIMIT 20
       FOR UPDATE OF s SKIP LOCKED`,
      [options.organizationId ?? null],
    );
    for (const person of people.rows) {
      const items = await client.query<DigestItem & { id: string }>(
        `SELECT n.id, n.kind, a.display_name AS actor_name, p.key AS project_key, t.number, t.title
         FROM notifications n
         JOIN projects p ON p.id = n.project_id
         JOIN tasks t ON t.id = n.task_id
         LEFT JOIN users a ON a.id = n.actor_user_id
         WHERE n.organization_id = $1 AND n.recipient_user_id = $2
           AND n.email_status = 'pending' AND n.read_at IS NULL
         ORDER BY n.created_at LIMIT $3`,
        [person.organization_id, person.user_id, options.maxItems ?? 20],
      );
      if (items.rows.length === 0) continue;
      await send(composeDigest(person, items.rows, options.webOrigin));
      await client.query(
        `UPDATE notifications SET email_status = 'sent' WHERE id = ANY($1::uuid[])`,
        [items.rows.map((i) => i.id)],
      );
      await client.query(
        `UPDATE notification_settings SET last_digest_at = now()
         WHERE organization_id = $1 AND user_id = $2`,
        [person.organization_id, person.user_id],
      );
      await countUsage(client, person.organization_id, 'notification_emails');
      sent += 1;
    }
    await client.query('COMMIT');
    return sent;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
