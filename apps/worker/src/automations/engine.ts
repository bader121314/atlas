import type { Pool, PoolClient } from 'pg';
import { matchesConditions } from '@atlas/contracts';
import type {
  AutomationAction,
  AutomationConditions,
  AutomationTrigger,
} from '@atlas/contracts';

/** Rule actions can cause further rules this many levels deep, no more. */
export const MAX_DEPTH = 3;

/** Worker quota: rule applications per organization per hour. */
export const HOURLY_QUOTA = 1000;

interface EventRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  aggregate_id: string;
  event_type: string;
  payload: {
    changes?: { state?: unknown };
    automation?: { ruleId?: string; depth?: number };
  };
}

interface RuleRow {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  created_by_user_id: string;
}

/** Whether an event starts a rule's trigger. */
export function triggers(
  trigger: AutomationTrigger,
  event: { type: string; stateChanged: boolean; stateId: string | null },
): boolean {
  if (trigger.type === 'task.created') return event.type === 'task.created';
  if (trigger.type === 'comment.created')
    return event.type === 'comment.created';
  return (
    event.type === 'task.updated' &&
    event.stateChanged &&
    (!trigger.toStateId || trigger.toStateId === event.stateId)
  );
}

/** Thrown when an action cannot apply; the run is recorded as failed. */
class ActionError extends Error {}

async function record(
  client: PoolClient,
  input: {
    organizationId: string;
    projectId: string;
    taskId: string;
    actor: string;
    action: 'task.updated' | 'comment.created';
    changes: Record<string, unknown>;
    version: number;
    ruleId: string;
    depth: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO activity_events (organization_id, project_id, task_id, actor_user_id, action, changes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.organizationId,
      input.projectId,
      input.taskId,
      input.actor,
      input.action,
      JSON.stringify(input.changes),
    ],
  );
  await client.query(
    `INSERT INTO outbox_events (organization_id, project_id, aggregate_type, aggregate_id,
       aggregate_version, event_type, payload)
     VALUES ($1, $2, 'task', $3, $4, $5, $6)`,
    [
      input.organizationId,
      input.projectId,
      input.taskId,
      input.version,
      input.action,
      JSON.stringify({
        projectId: input.projectId,
        taskId: input.taskId,
        actorUserId: input.actor,
        changes: input.changes,
        automation: { ruleId: input.ruleId, depth: input.depth },
      }),
    ],
  );
}

/** Applies a rule's actions to a task inside the caller's transaction. */
async function apply(
  client: PoolClient,
  event: EventRow & { project_id: string },
  rule: RuleRow,
  depth: number,
): Promise<void> {
  const org = event.organization_id;
  const project = event.project_id;
  const task = event.aggregate_id;
  // The rule acts as the person who made it, so they must still be able to
  // change tasks in this project.
  const creator = await client.query(
    `SELECT 1 FROM organization_memberships m
     JOIN projects p ON p.organization_id = m.organization_id AND p.id = $3
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = m.user_id
     WHERE m.organization_id = $1 AND m.user_id = $2 AND m.state = 'active'
       AND (m.role IN ('owner', 'admin') OR pm.role IN ('manager', 'editor')
            OR (m.role = 'member' AND pm.role IS NULL AND p.visibility = 'organization'))`,
    [org, rule.created_by_user_id, project],
  );
  if (!creator.rowCount) throw new ActionError('creator access');
  const changes: Record<string, unknown> = { automation: rule.name };
  for (const action of rule.actions) {
    switch (action.type) {
      case 'set_priority':
        await client.query('UPDATE tasks SET priority = $2 WHERE id = $1', [
          task,
          action.priority,
        ]);
        changes.priority = action.priority;
        break;
      case 'assign': {
        const ok = await client.query(
          `SELECT 1 FROM organization_memberships m
           JOIN projects p ON p.organization_id = m.organization_id AND p.id = $3
           LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = m.user_id
           WHERE m.organization_id = $1 AND m.user_id = $2 AND m.state = 'active'
             AND (m.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL
                  OR (m.role = 'member' AND p.visibility = 'organization'))`,
          [org, action.userId, project],
        );
        if (!ok.rowCount) throw new ActionError('assignee');
        await client.query(
          'UPDATE tasks SET assignee_user_id = $2 WHERE id = $1',
          [task, action.userId],
        );
        changes.assignee = action.userId;
        break;
      }
      case 'add_label': {
        const added = await client.query(
          `INSERT INTO task_labels (organization_id, task_id, label_id)
           SELECT $1, $2, l.id FROM labels l WHERE l.organization_id = $1 AND l.id = $3
           ON CONFLICT DO NOTHING`,
          [org, task, action.labelId],
        );
        const exists = await client.query(
          'SELECT 1 FROM labels WHERE organization_id = $1 AND id = $2',
          [org, action.labelId],
        );
        if (!exists.rowCount) throw new ActionError('label');
        if (added.rowCount) changes.labels = true;
        break;
      }
      case 'set_state': {
        const state = await client.query<{ category: string; key: string }>(
          'SELECT category, key FROM workflow_states WHERE organization_id = $1 AND project_id = $2 AND id = $3',
          [org, project, action.stateId],
        );
        const row = state.rows[0];
        if (!row) throw new ActionError('state');
        await client.query(
          `UPDATE tasks SET state_id = $2, completed_at = CASE WHEN $3 THEN COALESCE(completed_at, now()) ELSE NULL END
           WHERE id = $1`,
          [task, action.stateId, row.category === 'done'],
        );
        changes.state = row.key;
        break;
      }
      case 'comment':
        await client.query(
          `INSERT INTO task_comments (organization_id, task_id, author_user_id, body) VALUES ($1, $2, $3, $4)`,
          [org, task, rule.created_by_user_id, action.body],
        );
        changes.comment = true;
        break;
    }
  }
  const updated = await client.query<{ version: string }>(
    `UPDATE tasks SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING version`,
    [task],
  );
  await record(client, {
    organizationId: org,
    projectId: project,
    taskId: task,
    actor: rule.created_by_user_id,
    action: 'task.updated',
    changes,
    version: Number(updated.rows[0]?.version ?? 0),
    ruleId: rule.id,
    depth,
  });
}

/**
 * Runs automation rules for one batch of outbox events (ADR-038). Each
 * (rule, event) pair runs at most once; events caused by rules carry their
 * depth, and nothing runs past MAX_DEPTH or on a rule's own changes.
 */
export async function runAutomations(
  pool: Pool,
  options: { organizationId?: string } = {},
): Promise<{ applied: number; skipped: number; failed: number }> {
  const client = await pool.connect();
  const result = { applied: 0, skipped: 0, failed: 0 };
  try {
    await client.query('BEGIN');
    const events = await client.query<EventRow>(
      `SELECT id, organization_id, project_id, aggregate_id, event_type, payload
       FROM outbox_events
       WHERE automations_at IS NULL AND ($1::uuid IS NULL OR organization_id = $1)
       ORDER BY occurred_at, id LIMIT 50
       FOR UPDATE SKIP LOCKED`,
      [options.organizationId ?? null],
    );
    for (const event of events.rows) {
      const projectId = event.project_id;
      if (!projectId) continue;
      const rules = await client.query<RuleRow>(
        `SELECT id, name, trigger, conditions, actions, created_by_user_id
         FROM automation_rules WHERE organization_id = $1 AND project_id = $2 AND enabled
         ORDER BY created_at`,
        [event.organization_id, projectId],
      );
      if (rules.rows.length === 0) continue;
      const task = await client.query<{
        priority: string;
        assignee_user_id: string | null;
        state_id: string;
        labels: string[];
      }>(
        `SELECT t.priority, t.assignee_user_id, t.state_id,
           ARRAY(SELECT label_id::text FROM task_labels WHERE task_id = t.id) AS labels
         FROM tasks t WHERE t.organization_id = $1 AND t.id = $2`,
        [event.organization_id, event.aggregate_id],
      );
      const current = task.rows[0];
      if (!current) continue;
      const depth = (event.payload.automation?.depth ?? 0) + 1;
      const facts = {
        type: event.event_type,
        stateChanged: event.payload.changes?.state !== undefined,
        stateId: current.state_id,
      };
      for (const rule of rules.rows) {
        if (!triggers(rule.trigger, facts)) continue;
        if (
          !matchesConditions(
            {
              priority: current.priority,
              labelIds: current.labels,
              assigneeId: current.assignee_user_id,
            },
            rule.conditions,
          )
        )
          continue;
        let status: 'applied' | 'skipped' | 'failed' = 'applied';
        let detail: string | null = null;
        if (event.payload.automation?.ruleId === rule.id) {
          status = 'skipped';
          detail = 'own change';
        } else if (depth > MAX_DEPTH) {
          status = 'skipped';
          detail = 'depth limit';
        } else {
          const used = await client.query<{ count: string }>(
            `SELECT count(*) FROM automation_runs WHERE organization_id = $1
               AND status = 'applied' AND created_at > now() - interval '1 hour'`,
            [event.organization_id],
          );
          if (Number(used.rows[0]?.count) >= HOURLY_QUOTA) {
            status = 'skipped';
            detail = 'quota';
          }
        }
        const claimed = await client.query(
          `INSERT INTO automation_runs (organization_id, project_id, rule_id, event_id, task_id, status, detail)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (rule_id, event_id) DO NOTHING RETURNING id`,
          [
            event.organization_id,
            projectId,
            rule.id,
            event.id,
            event.aggregate_id,
            status,
            detail,
          ],
        );
        const runId = claimed.rows[0] as { id: string } | undefined;
        if (!runId) continue;
        if (status === 'applied') {
          await client.query('SAVEPOINT rule');
          try {
            await apply(
              client,
              { ...event, project_id: projectId },
              rule,
              depth,
            );
            await client.query('RELEASE SAVEPOINT rule');
          } catch (error) {
            // Undo this rule's partial changes and record why.
            await client.query('ROLLBACK TO SAVEPOINT rule');
            status = 'failed';
            await client.query(
              `UPDATE automation_runs SET status = 'failed', detail = $2 WHERE id = $1`,
              [
                runId.id,
                error instanceof ActionError ? error.message : 'error',
              ],
            );
          }
        }
        result[status] += 1;
      }
    }
    if (events.rows.length > 0) {
      await client.query(
        'UPDATE outbox_events SET automations_at = clock_timestamp() WHERE id = ANY($1::uuid[])',
        [events.rows.map((e) => e.id)],
      );
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
