import type { Pool } from 'pg';
import {
  encryptPush,
  isPushServiceUrl,
  message,
  messageLocale,
  vapidAuthorization,
} from '@atlas/shared';
import type { VapidKeys } from '@atlas/shared';

/** Sends one encrypted message; returns the push service's status code. */
export type PushSender = (
  endpoint: string,
  headers: Record<string, string>,
  body: Buffer,
) => Promise<number>;

/** The default sender: no redirects, five-second timeout. */
export const fetchPushSender: PushSender = async (endpoint, headers, body) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: new Uint8Array(body),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  return response.status;
};

interface Row {
  id: string;
  kind: 'task.assigned' | 'comment.created' | 'mention';
  recipient_user_id: string;
  actor_name: string | null;
  slug: string;
  project_key: string;
  number: number;
  title: string;
  /** The recipient's language (ADR-066); English when absent. */
  locale?: string;
}

/** The visible text of a push message. Bodies of comments are never sent. */
export function composePush(row: Row, webOrigin: string) {
  const locale = messageLocale(row.locale);
  const key = `${row.project_key}-${row.number}`;
  const who = row.actor_name ?? message(locale, 'someone');
  const kind =
    row.kind === 'task.assigned'
      ? 'assigned'
      : row.kind === 'mention'
        ? 'mention'
        : 'comment';
  return {
    title: message(locale, `${kind}.push` as const, { who, key }),
    body: row.title,
    url: `${webOrigin}/organizations/${row.slug}/projects/${row.project_key}/tasks/${row.number}`,
    tag: `${key}`,
  };
}

/**
 * Pushes new notifications to the recipients' browsers (ADR-060). Read
 * notifications and people without subscriptions are marked skipped.
 * Subscriptions the push service reports gone (404, 410) are deleted;
 * others that keep failing are dropped after ten failures.
 */
export async function pushBatch(
  pool: Pool,
  send: PushSender,
  options: {
    keys: VapidKeys;
    webOrigin: string;
    extraHosts?: string[];
    organizationId?: string;
  },
): Promise<{ sent: number; skipped: number }> {
  const client = await pool.connect();
  const result = { sent: 0, skipped: 0 };
  try {
    await client.query('BEGIN');
    const rows = await client.query<Row>(
      `SELECT n.id, n.kind, n.recipient_user_id, a.display_name AS actor_name,
              o.slug, p.key AS project_key, t.number, t.title, r.locale
       FROM notifications n
       JOIN users r ON r.id = n.recipient_user_id
       LEFT JOIN users a ON a.id = n.actor_user_id
       JOIN organizations o ON o.id = n.organization_id
       JOIN projects p ON p.id = n.project_id
       JOIN tasks t ON t.id = n.task_id
       WHERE n.push_status = 'pending'
         AND ($1::uuid IS NULL OR n.organization_id = $1)
       ORDER BY n.created_at LIMIT 50
       FOR UPDATE OF n SKIP LOCKED`,
      [options.organizationId ?? null],
    );
    for (const row of rows.rows) {
      const read = await client.query(
        'SELECT 1 FROM notifications WHERE id = $1 AND read_at IS NOT NULL',
        [row.id],
      );
      const subscriptions = read.rowCount
        ? { rows: [] }
        : await client.query<{
            id: string;
            endpoint: string;
            p256dh: string;
            auth: string;
          }>(
            'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
            [row.recipient_user_id],
          );
      let delivered = false;
      const message = Buffer.from(
        JSON.stringify(composePush(row, options.webOrigin)),
      );
      for (const subscription of subscriptions.rows) {
        if (!isPushServiceUrl(subscription.endpoint, options.extraHosts))
          continue;
        let status = 0;
        try {
          status = await send(
            subscription.endpoint,
            {
              authorization: vapidAuthorization(
                subscription.endpoint,
                options.keys,
              ),
              'content-encoding': 'aes128gcm',
              'content-type': 'application/octet-stream',
              ttl: '86400',
              urgency: 'normal',
            },
            encryptPush(subscription, message),
          );
        } catch {
          status = 0;
        }
        if (status >= 200 && status < 300) {
          delivered = true;
          await client.query(
            `UPDATE push_subscriptions SET last_success_at = now(), failures = 0
             WHERE id = $1`,
            [subscription.id],
          );
        } else if (status === 404 || status === 410) {
          await client.query('DELETE FROM push_subscriptions WHERE id = $1', [
            subscription.id,
          ]);
        } else {
          await client.query(
            `DELETE FROM push_subscriptions WHERE id = $1 AND failures >= 9`,
            [subscription.id],
          );
          await client.query(
            'UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1',
            [subscription.id],
          );
        }
      }
      await client.query(
        'UPDATE notifications SET push_status = $2 WHERE id = $1',
        [row.id, delivered ? 'sent' : 'skipped'],
      );
      if (delivered) result.sent += 1;
      else result.skipped += 1;
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
