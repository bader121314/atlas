import type { Pool } from 'pg';
import { nextOccurrence } from '@atlas/contracts';
import type { RecurrenceFrequency } from '@atlas/contracts';

interface Due {
  id: string;
  organization_id: string;
  project_id: string;
  title: string;
  description: string;
  priority: string;
  assignee_user_id: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  due_in_days: number | null;
  next_run_at: Date;
  created_by_user_id: string;
}

/**
 * Creates the tasks of due recurrences (ADR-039). The recurrence is
 * claimed and moved to its next occurrence in the same transaction as the
 * new task, so each occurrence creates exactly one task. A recurrence whose
 * creator can no longer edit the project, or whose project is archived, is
 * turned off instead.
 */
export async function runRecurrences(
  pool: Pool,
  options: { organizationId?: string; now?: Date } = {},
): Promise<{ created: number; disabled: number }> {
  const now = options.now ?? new Date();
  const client = await pool.connect();
  const result = { created: 0, disabled: 0 };
  try {
    await client.query('BEGIN');
    const due = await client.query<Due>(
      `SELECT r.* FROM task_recurrences r
       WHERE r.enabled AND r.next_run_at <= $1
         AND ($2::uuid IS NULL OR r.organization_id = $2)
       ORDER BY r.next_run_at LIMIT 20
       FOR UPDATE SKIP LOCKED`,
      [now, options.organizationId ?? null],
    );
    for (const r of due.rows) {
      const allowed = await client.query(
        `SELECT 1 FROM organization_memberships m
         JOIN projects p ON p.organization_id = m.organization_id AND p.id = $3 AND p.status = 'active'
         LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = m.user_id
         WHERE m.organization_id = $1 AND m.user_id = $2 AND m.state = 'active'
           AND (m.role IN ('owner', 'admin') OR pm.role IN ('manager', 'editor')
                OR (m.role = 'member' AND pm.role IS NULL AND p.visibility = 'organization'))`,
        [r.organization_id, r.created_by_user_id, r.project_id],
      );
      if (!allowed.rowCount) {
        await client.query(
          'UPDATE task_recurrences SET enabled = false WHERE id = $1',
          [r.id],
        );
        result.disabled += 1;
        continue;
      }
      const counter = await client.query<{ number: number }>(
        `UPDATE projects SET next_task_number = next_task_number + 1
         WHERE organization_id = $1 AND id = $2 RETURNING next_task_number - 1 AS number`,
        [r.organization_id, r.project_id],
      );
      const number = counter.rows[0]?.number;
      const state = await client.query<{ id: string; key: string }>(
        `SELECT id, key FROM workflow_states WHERE organization_id = $1 AND project_id = $2
         ORDER BY position LIMIT 1`,
        [r.organization_id, r.project_id],
      );
      const created = await client.query<{ id: string }>(
        `INSERT INTO tasks (organization_id, project_id, number, title, description, state_id,
           priority, assignee_user_id, due_at, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
           CASE WHEN $9::int IS NULL THEN NULL ELSE $10::timestamptz + $9::int * interval '1 day' END, $11)
         RETURNING id`,
        [
          r.organization_id,
          r.project_id,
          number,
          r.title,
          r.description,
          state.rows[0]?.id,
          r.priority,
          r.assignee_user_id,
          r.due_in_days,
          r.next_run_at,
          r.created_by_user_id,
        ],
      );
      const taskId = created.rows[0]?.id ?? '';
      const changes = {
        number,
        state: state.rows[0]?.key ?? null,
        priority: r.priority,
        recurrence: r.title,
        ...(r.assignee_user_id ? { assignee: r.assignee_user_id } : {}),
      };
      await client.query(
        `INSERT INTO activity_events (organization_id, project_id, task_id, actor_user_id, action, changes)
         VALUES ($1, $2, $3, $4, 'task.created', $5)`,
        [
          r.organization_id,
          r.project_id,
          taskId,
          r.created_by_user_id,
          JSON.stringify(changes),
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (organization_id, project_id, aggregate_type, aggregate_id,
           aggregate_version, event_type, payload)
         VALUES ($1, $2, 'task', $3, 1, 'task.created', $4)`,
        [
          r.organization_id,
          r.project_id,
          taskId,
          JSON.stringify({
            projectId: r.project_id,
            taskId,
            actorUserId: r.created_by_user_id,
            changes,
          }),
        ],
      );
      await client.query(
        'UPDATE task_recurrences SET next_run_at = $2, last_run_at = now() WHERE id = $1',
        [r.id, nextOccurrence(r.next_run_at, r.frequency, r.interval, now)],
      );
      result.created += 1;
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
