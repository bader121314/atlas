import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { WorkflowState } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { ActivityService } from './activity.service';

const MAX_STATES = 20;

function slug(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return /^[a-z]/.test(base) ? base : `s_${base || 'state'}`;
}

/**
 * Project workflow customization (ADR-022). Managers add, rename,
 * recategorize, reorder and delete states; tasks in a deleted state move to a
 * chosen state in the same transaction, each with its own activity entry.
 */
@Injectable()
export class StatesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  private async lockStates(
    client: PoolClient,
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<WorkflowState[]> {
    const result = await client.query<WorkflowState>(
      `SELECT id, key, label, category, position FROM workflow_states
       WHERE organization_id = $1 AND project_id = $2
       ORDER BY position FOR UPDATE`,
      [tenant.organizationId, project.id],
    );
    return result.rows;
  }

  async create(
    tenant: TenantContext,
    project: ProjectContext,
    label: string,
    category: WorkflowState['category'],
  ): Promise<WorkflowState> {
    return this.database.transaction(async (client) => {
      const states = await this.lockStates(client, tenant, project);
      if (states.length >= MAX_STATES) throw new ConflictException();
      const taken = new Set(states.map((s) => s.key));
      let key = slug(label);
      for (let n = 2; taken.has(key); n += 1)
        key = `${slug(label).slice(0, 20)}_${n}`;
      const position = Math.max(0, ...states.map((s) => s.position)) + 1;
      const result = await client.query<WorkflowState>(
        `INSERT INTO workflow_states (organization_id, project_id, key, label, category, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, key, label, category, position`,
        [tenant.organizationId, project.id, key, label, category, position],
      );
      const row = result.rows[0];
      if (!row) throw new Error('state insert returned no row');
      return row;
    });
  }

  /** Category changes keep task completion consistent with the new meaning. */
  async update(
    tenant: TenantContext,
    project: ProjectContext,
    stateId: string,
    changes: {
      label?: string | undefined;
      category?: WorkflowState['category'] | undefined;
    },
  ): Promise<WorkflowState> {
    return this.database.transaction(async (client) => {
      const states = await this.lockStates(client, tenant, project);
      if (!states.some((s) => s.id === stateId)) throw new NotFoundException();
      const result = await client.query<WorkflowState>(
        `UPDATE workflow_states SET
           label = COALESCE($4, label), category = COALESCE($5, category)
         WHERE organization_id = $1 AND project_id = $2 AND id = $3
         RETURNING id, key, label, category, position`,
        [
          tenant.organizationId,
          project.id,
          stateId,
          changes.label ?? null,
          changes.category ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException();
      if (changes.category) {
        await client.query(
          `UPDATE tasks SET completed_at = CASE
             WHEN $4 = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
           WHERE organization_id = $1 AND project_id = $2 AND state_id = $3`,
          [tenant.organizationId, project.id, stateId, changes.category],
        );
      }
      return row;
    });
  }

  /** The new order must list every state exactly once. */
  async reorder(
    tenant: TenantContext,
    project: ProjectContext,
    stateIds: string[],
  ): Promise<WorkflowState[]> {
    return this.database.transaction(async (client) => {
      const states = await this.lockStates(client, tenant, project);
      const known = new Set(states.map((s) => s.id));
      const unique = new Set(stateIds);
      if (
        unique.size !== stateIds.length ||
        unique.size !== known.size ||
        stateIds.some((id) => !known.has(id))
      ) {
        throw new BadRequestException();
      }
      await client.query(
        `UPDATE workflow_states w SET position = o.position
         FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, position)
         WHERE w.organization_id = $1 AND w.project_id = $2 AND w.id = o.id`,
        [tenant.organizationId, project.id, stateIds],
      );
      return await this.lockStates(client, tenant, project);
    });
  }

  /**
   * Deletes a state. Tasks in it move to `moveTo` (required when any exist);
   * the last state of a project cannot be deleted.
   */
  async remove(
    tenant: TenantContext,
    project: ProjectContext,
    actorUserId: string,
    stateId: string,
    moveTo: string | undefined,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const states = await this.lockStates(client, tenant, project);
      const doomed = states.find((s) => s.id === stateId);
      if (!doomed) throw new NotFoundException();
      if (states.length === 1) throw new ConflictException();
      const target = moveTo
        ? states.find((s) => s.id === moveTo && s.id !== stateId)
        : undefined;
      if (moveTo && !target) throw new BadRequestException();
      const moved = await client.query<{ id: string; version: string }>(
        target
          ? `UPDATE tasks SET state_id = $4, version = version + 1, updated_at = now(),
               completed_at = CASE WHEN $5 = 'done'
                 THEN COALESCE(completed_at, now()) ELSE NULL END
             WHERE organization_id = $1 AND project_id = $2 AND state_id = $3
             RETURNING id, version`
          : `SELECT id, version FROM tasks
             WHERE organization_id = $1 AND project_id = $2 AND state_id = $3
             LIMIT 1`,
        target
          ? [
              tenant.organizationId,
              project.id,
              stateId,
              target.id,
              target.category,
            ]
          : [tenant.organizationId, project.id, stateId],
      );
      if (!target && moved.rowCount) throw new ConflictException();
      for (const task of moved.rows) {
        await this.activity.record(client, {
          organizationId: tenant.organizationId,
          projectId: project.id,
          taskId: task.id,
          actorUserId,
          action: 'task.updated',
          changes: { state: { from: doomed.key, to: target?.key ?? null } },
          aggregateVersion: Number(task.version),
        });
      }
      await client.query(
        'DELETE FROM workflow_states WHERE organization_id = $1 AND project_id = $2 AND id = $3',
        [tenant.organizationId, project.id, stateId],
      );
    });
  }
}
