import type { Pool, PoolClient } from 'pg';

export type NotificationKind = 'task.assigned' | 'comment.created' | 'mention';

interface EventRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  aggregate_id: string;
  event_type: string;
  payload: {
    actorUserId?: string;
    mentions?: string[];
    assigned?: string[];
    changes?: { assignee?: string | { to?: string | null } };
  };
}

/** Who should hear about an event, before access checks. */
export async function recipientsFor(
  client: PoolClient,
  event: EventRow,
): Promise<{ kind: NotificationKind; userIds: string[] } | undefined> {
  const assignee = event.payload.changes?.assignee;
  if (event.event_type === 'task.created') {
    // Created already assigned: the event records the assignee.
    return typeof assignee === 'string'
      ? { kind: 'task.assigned', userIds: [assignee] }
      : undefined;
  }
  if (event.event_type === 'task.updated') {
    // A new primary assignee, and anyone added to the assignee list.
    const to = typeof assignee === 'object' ? assignee.to : undefined;
    const userIds = [...(to ? [to] : []), ...(event.payload.assigned ?? [])];
    return userIds.length ? { kind: 'task.assigned', userIds } : undefined;
  }
  if (event.event_type === 'comment.created') {
    // The reporter, the assignee and everyone who has commented.
    const people = await client.query<{ user_id: string | null }>(
      `SELECT created_by_user_id AS user_id FROM tasks
         WHERE organization_id = $1 AND id = $2
       UNION SELECT assignee_user_id FROM tasks
         WHERE organization_id = $1 AND id = $2
       UNION SELECT author_user_id FROM task_comments
         WHERE organization_id = $1 AND task_id = $2 AND deleted_at IS NULL`,
      [event.organization_id, event.aggregate_id],
    );
    return {
      kind: 'comment.created',
      userIds: people.rows.flatMap((r) => (r.user_id ? [r.user_id] : [])),
    };
  }
  return undefined;
}

/**
 * Turns one batch of outbox events into notifications (ADR-031). The rows
 * are claimed and marked in the same transaction as the inserts, so each
 * event notifies exactly once; the unique (recipient, event) key makes a
 * retry harmless as well. Nobody is notified of their own action, and only
 * people who can currently read the project are notified.
 */
export async function notifyBatch(
  pool: Pool,
  options: { batchSize?: number; organizationId?: string } = {},
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const events = await client.query<EventRow>(
      `SELECT id, organization_id, project_id, aggregate_id, event_type, payload
       FROM outbox_events
       WHERE notified_at IS NULL
         AND ($2::uuid IS NULL OR organization_id = $2)
       ORDER BY occurred_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [options.batchSize ?? 100, options.organizationId ?? null],
    );
    let created = 0;
    for (const event of events.rows) {
      if (!event.project_id) continue;
      const target = await recipientsFor(client, event);
      const actor = event.payload.actorUserId ?? null;
      // Mentions come first, so someone both mentioned and following the
      // task gets the more specific notification (one per event).
      const groups: { kind: NotificationKind; userIds: string[] }[] = [];
      if (
        event.event_type === 'comment.created' &&
        event.payload.mentions?.length
      )
        groups.push({ kind: 'mention', userIds: event.payload.mentions });
      if (target) groups.push(target);
      for (const group of groups) {
        const userIds = [...new Set(group.userIds)].filter(
          (id) => id !== actor,
        );
        if (userIds.length === 0) continue;
        const inserted = await client.query(
          `INSERT INTO notifications (organization_id, recipient_user_id, kind,
           project_id, task_id, actor_user_id, source_event_id)
         SELECT $1, m.user_id, $3, p.id, t.id, $6, $7
         FROM organization_memberships m
         JOIN projects p ON p.organization_id = $1 AND p.id = $4
         JOIN tasks t ON t.organization_id = $1 AND t.project_id = p.id AND t.id = $5
         LEFT JOIN project_memberships pm
           ON pm.project_id = p.id AND pm.user_id = m.user_id
         WHERE m.organization_id = $1 AND m.user_id = ANY($2::uuid[])
           AND m.state = 'active'
           AND (m.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL
                OR (m.role = 'member' AND p.visibility = 'organization'))
         ON CONFLICT (recipient_user_id, source_event_id) DO NOTHING`,
          [
            event.organization_id,
            userIds,
            group.kind,
            event.project_id,
            event.aggregate_id,
            actor,
            event.id,
          ],
        );
        created += inserted.rowCount ?? 0;
      }
    }
    if (events.rows.length > 0) {
      await client.query(
        'UPDATE outbox_events SET notified_at = clock_timestamp() WHERE id = ANY($1::uuid[])',
        [events.rows.map((e) => e.id)],
      );
    }
    await client.query('COMMIT');
    return created;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
