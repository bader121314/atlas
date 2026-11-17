import type { Pool } from 'pg';
import { projectChannel } from '@atlas/contracts';
import type { ProjectEvent } from '@atlas/contracts';

export type Publish = (channel: string, message: string) => Promise<unknown>;

export interface DispatchOptions {
  batchSize?: number;
  /** Restricts a run to one organization (used by tests and replays). */
  organizationId?: string;
}

export interface DispatchResult {
  published: number;
  failed: number;
}

interface Row {
  id: string;
  organization_id: string;
  project_id: string | null;
  aggregate_id: string;
  aggregate_version: string;
  event_type: string;
  payload: { actorUserId?: string };
  occurred_at: Date;
  attempt_count: number;
}

/** Retry delay after a failed attempt: 1 s doubling, capped at 5 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(attempts - 1, 0), 300_000);
}

export function toEnvelope(row: Row): ProjectEvent | undefined {
  if (!row.project_id) return undefined;
  return {
    id: row.id,
    type: row.event_type,
    organizationId: row.organization_id,
    projectId: row.project_id,
    taskId: row.aggregate_id,
    version: Number(row.aggregate_version),
    actorUserId: row.payload.actorUserId ?? null,
    occurredAt: row.occurred_at.toISOString(),
  };
}

/**
 * Publishes one batch of committed, unpublished outbox events (ADR-028).
 *
 * Rows are claimed with FOR UPDATE SKIP LOCKED, so several workers can run
 * at once without publishing an event twice in the normal case. Only
 * committed rows are visible, so nothing is published before the change it
 * describes. Delivery is at least once: if the process stops between
 * publishing and committing, the event is sent again and consumers drop it
 * by id.
 */
export async function dispatchBatch(
  pool: Pool,
  publish: Publish,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const client = await pool.connect();
  const result: DispatchResult = { published: 0, failed: 0 };
  try {
    await client.query('BEGIN');
    const rows = await client.query<Row>(
      `SELECT id, organization_id, project_id, aggregate_id, aggregate_version,
              event_type, payload, occurred_at, attempt_count
       FROM outbox_events
       WHERE published_at IS NULL
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND ($2::uuid IS NULL OR organization_id = $2)
       ORDER BY occurred_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [options.batchSize ?? 100, options.organizationId ?? null],
    );
    const published: string[] = [];
    for (const row of rows.rows) {
      const envelope = toEnvelope(row);
      try {
        if (envelope) {
          await publish(
            projectChannel(envelope.organizationId, envelope.projectId),
            JSON.stringify(envelope),
          );
        }
        published.push(row.id);
      } catch {
        // Keep order per batch: stop at the first failure and retry later.
        const attempts = row.attempt_count + 1;
        await client.query(
          `UPDATE outbox_events SET attempt_count = $2,
             next_attempt_at = now() + ($3 * interval '1 millisecond')
           WHERE id = $1`,
          [row.id, attempts, retryDelayMs(attempts)],
        );
        result.failed += 1;
        break;
      }
    }
    if (published.length > 0) {
      await client.query(
        `UPDATE outbox_events SET published_at = clock_timestamp(),
           attempt_count = attempt_count + 1, next_attempt_at = NULL
         WHERE id = ANY($1::uuid[])`,
        [published],
      );
    }
    await client.query('COMMIT');
    result.published = published.length;
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Deletes published events older than the replay window. */
export async function prunePublished(
  pool: Pool,
  olderThanHours: number,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM outbox_events
     WHERE published_at < now() - ($1 * interval '1 hour')`,
    [olderThanHours],
  );
  return result.rowCount ?? 0;
}
