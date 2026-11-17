import type { Pool } from 'pg';
import { toCsv } from '@atlas/shared';

export { csvCell, toCsv } from '@atlas/shared';

/** What the exporter needs from storage; ObjectStore implements it. */
export interface ExportStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const EXPIRY_HOURS = 24;
const MAX_ROWS = 50_000;

const HEADER = [
  'Key',
  'Title',
  'Status',
  'Priority',
  'Assignee',
  'Due',
  'Labels',
  'Milestone',
  'Parent',
  'Created',
  'Completed',
  // Added in M9; appended so existing columns keep their positions.
  'Start',
  'Time logged (minutes)',
  'Estimate (minutes)',
];

interface Job {
  id: string;
  organization_id: string;
  project_id: string;
  allowed: boolean;
}

/**
 * Builds queued exports (ADR-035). The requester must still be allowed to
 * export when the job runs; otherwise it fails without producing a file.
 */
export async function runExports(
  pool: Pool,
  store: ExportStore,
  options: { organizationId?: string } = {},
): Promise<{ ready: number; failed: number }> {
  const client = await pool.connect();
  const result = { ready: 0, failed: 0 };
  try {
    await client.query('BEGIN');
    const jobs = await client.query<Job>(
      `SELECT e.id, e.organization_id, e.project_id,
         (m.state = 'active' AND (m.role IN ('owner', 'admin')
           OR (m.role = 'member' AND (pm.role IN ('manager', 'editor')
               OR (pm.role IS NULL AND p.visibility = 'organization'))))) IS TRUE AS allowed
       FROM exports e
       JOIN projects p ON p.id = e.project_id
       LEFT JOIN organization_memberships m
         ON m.organization_id = e.organization_id AND m.user_id = e.requested_by_user_id
       LEFT JOIN project_memberships pm
         ON pm.project_id = e.project_id AND pm.user_id = e.requested_by_user_id
       WHERE e.status = 'queued' AND ($1::uuid IS NULL OR e.organization_id = $1)
       ORDER BY e.created_at LIMIT 2
       FOR UPDATE OF e SKIP LOCKED`,
      [options.organizationId ?? null],
    );
    for (const job of jobs.rows) {
      if (!job.allowed) {
        await client.query(
          `UPDATE exports SET status = 'failed', finished_at = now() WHERE id = $1`,
          [job.id],
        );
        result.failed += 1;
        continue;
      }
      const tasks = await client.query<{
        key: string;
        number: number;
        title: string;
        state: string;
        priority: string;
        assignee: string | null;
        due_at: Date | null;
        labels: string | null;
        milestone: string | null;
        parent: number | null;
        created_at: Date;
        completed_at: Date | null;
        start_at: Date | null;
        minutes: string;
        estimate_minutes: number | null;
      }>(
        `SELECT p.key, t.number, t.title, ws.label AS state, t.priority,
                u.display_name AS assignee, t.due_at,
                (SELECT string_agg(l.name, '; ' ORDER BY l.name) FROM task_labels tl
                   JOIN labels l ON l.id = tl.label_id WHERE tl.task_id = t.id) AS labels,
                ms.title AS milestone, pt.number AS parent, t.created_at, t.completed_at,
                t.start_at, t.estimate_minutes,
                (SELECT COALESCE(sum(te.minutes), 0) FROM time_entries te
                   WHERE te.task_id = t.id) AS minutes
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         JOIN workflow_states ws ON ws.id = t.state_id
         LEFT JOIN users u ON u.id = t.assignee_user_id
         LEFT JOIN milestones ms ON ms.id = t.milestone_id
         LEFT JOIN tasks pt ON pt.id = t.parent_task_id
         WHERE t.organization_id = $1 AND t.project_id = $2
         ORDER BY t.number LIMIT ${MAX_ROWS}`,
        [job.organization_id, job.project_id],
      );
      const iso = (d: Date | null) => (d ? d.toISOString() : null);
      const csv = toCsv([
        HEADER,
        ...tasks.rows.map((t) => [
          `${t.key}-${t.number}`,
          t.title,
          t.state,
          t.priority,
          t.assignee,
          iso(t.due_at),
          t.labels,
          t.milestone,
          t.parent === null ? null : `${t.key}-${t.parent}`,
          iso(t.created_at),
          iso(t.completed_at),
          iso(t.start_at),
          Number(t.minutes),
          t.estimate_minutes,
        ]),
      ]);
      const key = `${job.organization_id}/${job.project_id}/exports/${job.id}.csv`;
      await store.put(
        key,
        new TextEncoder().encode(csv),
        'text/csv; charset=utf-8',
      );
      await client.query(
        `UPDATE exports SET status = 'ready', row_count = $2, storage_key = $3,
           finished_at = now(), expires_at = now() + ($4 * interval '1 hour')
         WHERE id = $1`,
        [job.id, tasks.rows.length, key, EXPIRY_HOURS],
      );
      result.ready += 1;
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

/** Deletes expired export files and marks them expired. */
export async function expireExports(
  pool: Pool,
  store: ExportStore,
  options: { organizationId?: string } = {},
): Promise<number> {
  const rows = await pool.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM exports
     WHERE status = 'ready' AND expires_at <= now()
       AND ($1::uuid IS NULL OR organization_id = $1)
     LIMIT 100`,
    [options.organizationId ?? null],
  );
  for (const row of rows.rows) {
    await store.remove(row.storage_key);
    await pool.query(`UPDATE exports SET status = 'expired' WHERE id = $1`, [
      row.id,
    ]);
  }
  return rows.rows.length;
}
