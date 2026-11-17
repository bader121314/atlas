import type { Pool } from 'pg';
import { WEBHOOK_EVENTS } from '@atlas/shared';

/**
 * Turns outbox events into webhook deliveries (ADR-036), exactly once: the
 * events are claimed and marked in the same transaction as the inserts, and
 * (endpoint, event) is unique. The payload is a snapshot taken now.
 */
export async function planBatch(
  pool: Pool,
  options: { organizationId?: string } = {},
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const events = await client.query<{
      id: string;
      organization_id: string;
      project_id: string | null;
      aggregate_id: string;
      event_type: string;
      occurred_at: Date;
      actor: string | null;
    }>(
      `SELECT id, organization_id, project_id, aggregate_id, event_type, occurred_at,
              payload ->> 'actorUserId' AS actor
       FROM outbox_events
       WHERE webhooks_at IS NULL AND ($1::uuid IS NULL OR organization_id = $1)
       ORDER BY occurred_at, id LIMIT 100
       FOR UPDATE SKIP LOCKED`,
      [options.organizationId ?? null],
    );
    let planned = 0;
    for (const event of events.rows) {
      if (!event.project_id) continue;
      if (!(WEBHOOK_EVENTS as readonly string[]).includes(event.event_type))
        continue;
      const inserted = await client.query(
        `INSERT INTO webhook_deliveries (organization_id, endpoint_id, event_id, event_type, payload)
         SELECT e.organization_id, e.id, $2, $3, jsonb_build_object(
           'id', $2::uuid,
           'type', $3::text,
           'occurredAt', to_char($5::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'actorUserId', $6::uuid,
           'task', jsonb_build_object(
             'id', t.id, 'key', p.key || '-' || t.number, 'number', t.number,
             'projectKey', p.key, 'title', t.title, 'state', ws.label,
             'priority', t.priority, 'version', t.version))
         FROM webhook_endpoints e
         JOIN tasks t ON t.organization_id = e.organization_id AND t.id = $4
         JOIN projects p ON p.id = t.project_id
         JOIN workflow_states ws ON ws.id = t.state_id
         WHERE e.organization_id = $1 AND e.status = 'active' AND $3 = ANY(e.events)
         ON CONFLICT (endpoint_id, event_id) DO NOTHING`,
        [
          event.organization_id,
          event.id,
          event.event_type,
          event.aggregate_id,
          event.occurred_at,
          event.actor,
        ],
      );
      planned += inserted.rowCount ?? 0;
    }
    if (events.rows.length > 0) {
      await client.query(
        'UPDATE outbox_events SET webhooks_at = clock_timestamp() WHERE id = ANY($1::uuid[])',
        [events.rows.map((e) => e.id)],
      );
    }
    await client.query('COMMIT');
    return planned;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
