import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

export type ActivityAction =
  | 'task.created'
  | 'task.updated'
  | 'comment.created'
  | 'comment.edited'
  | 'comment.deleted'
  | 'dependency.added'
  | 'dependency.removed';

type Scalar = string | number | boolean | null;
export type Changes = Record<string, Scalar | { from: Scalar; to: Scalar }>;

export interface ActivityInput {
  organizationId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
  action: ActivityAction;
  /** Field-level summary only: never comment bodies or descriptions. */
  changes: Changes;
  aggregateVersion: number;
}

/**
 * Writes the activity row and its outbox event with the caller's
 * transaction client, so history and notifications can never disagree with
 * the change itself (ADR-020). The worker's outbox dispatcher publishes the event
 * only after commit (ADR-028).
 */
@Injectable()
export class ActivityService {
  async record(client: PoolClient, input: ActivityInput): Promise<void> {
    await client.query(
      `INSERT INTO activity_events (organization_id, project_id, task_id,
         actor_user_id, action, changes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.organizationId,
        input.projectId,
        input.taskId,
        input.actorUserId,
        input.action,
        JSON.stringify(input.changes),
      ],
    );
    await client.query(
      `INSERT INTO outbox_events (organization_id, project_id, aggregate_type,
         aggregate_id, aggregate_version, event_type, payload)
       VALUES ($1, $6, 'task', $2, $3, $4, $5)`,
      [
        input.organizationId,
        input.taskId,
        input.aggregateVersion,
        input.action,
        JSON.stringify({
          projectId: input.projectId,
          taskId: input.taskId,
          actorUserId: input.actorUserId,
          changes: input.changes,
        }),
        input.projectId,
      ],
    );
  }
}
