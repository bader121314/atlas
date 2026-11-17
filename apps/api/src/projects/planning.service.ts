import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { PoolClient } from 'pg';
import type { DependenciesResponse, Milestone } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { ActivityService } from './activity.service';
import { inScope, scopeOf } from './label-scope';

interface MilestoneRow {
  id: string;
  title: string;
  due_at: Date | null;
  status: Milestone['status'];
  task_count: string;
  done_count: string;
}

function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    title: row.title,
    dueAt: row.due_at?.toISOString() ?? null,
    status: row.status,
    taskCount: Number(row.task_count),
    doneCount: Number(row.done_count),
  };
}

const MILESTONE_SELECT = `
  SELECT m.id, m.title, m.due_at, m.status,
    count(t.id) AS task_count,
    count(t.id) FILTER (WHERE t.completed_at IS NOT NULL) AS done_count
  FROM milestones m
  LEFT JOIN tasks t ON t.milestone_id = m.id`;

/** Dependencies between tasks and project milestones (ADR-024). */
@Injectable()
export class PlanningService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  private async task(
    runner: Pick<PoolClient, 'query'>,
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<{ id: string; version: number } | undefined> {
    const result = await runner.query<{ id: string; version: string }>(
      `SELECT id, version FROM tasks
       WHERE organization_id = $1 AND project_id = $2 AND number = $3
         AND ${inScope('tasks.id', '$4')}`,
      [tenant.organizationId, project.id, number, scopeOf(project)],
    );
    const row = result.rows[0];
    return row ? { id: row.id, version: Number(row.version) } : undefined;
  }

  async dependencies(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<DependenciesResponse> {
    const task = await this.task(this.database.pool, tenant, project, number);
    if (!task) throw new NotFoundException();
    const result = await this.database.pool.query<{
      direction: 'blockedBy' | 'blocking';
      number: number;
      title: string;
      done: boolean;
    }>(
      `SELECT 'blockedBy' AS direction, t.number, t.title,
         t.completed_at IS NOT NULL AS done
       FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_task_id
       WHERE d.organization_id = $1 AND d.blocked_task_id = $2
         AND ${inScope('t.id', '$3')}
       UNION ALL
       SELECT 'blocking', t.number, t.title, t.completed_at IS NOT NULL
       FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_task_id
       WHERE d.organization_id = $1 AND d.blocker_task_id = $2
         AND ${inScope('t.id', '$3')}
       ORDER BY 2`,
      [tenant.organizationId, task.id, scopeOf(project)],
    );
    const response: DependenciesResponse = { blockedBy: [], blocking: [] };
    for (const row of result.rows) {
      response[row.direction].push({
        number: row.number,
        key: `${project.key}-${row.number}`,
        title: row.title,
        done: row.done,
      });
    }
    return response;
  }

  /** Records "blocker blocks task". Loops and cross-project links are 400. */
  async addDependency(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    blockerNumber: number,
    userId: string,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const task = await this.task(client, tenant, project, number);
      if (!task) throw new NotFoundException();
      const blocker = await this.task(client, tenant, project, blockerNumber);
      if (!blocker || blocker.id === task.id) throw new BadRequestException();
      try {
        await client.query('SAVEPOINT add_dependency');
        await client.query(
          `INSERT INTO task_dependencies (organization_id, project_id, blocker_task_id, blocked_task_id)
           VALUES ($1, $2, $3, $4)`,
          [tenant.organizationId, project.id, blocker.id, task.id],
        );
      } catch (error) {
        if (error instanceof DatabaseError) {
          await client.query('ROLLBACK TO SAVEPOINT add_dependency');
          if (error.constraint === 'task_dependencies_cycle_check') {
            throw new BadRequestException();
          }
          if (error.code === '23505') throw new ConflictException();
        }
        throw error;
      }
      await this.activity.record(client, {
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: task.id,
        actorUserId: userId,
        action: 'dependency.added',
        changes: { blockedBy: blockerNumber },
        aggregateVersion: task.version,
      });
    });
  }

  async removeDependency(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    blockerNumber: number,
    userId: string,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const task = await this.task(client, tenant, project, number);
      const blocker = await this.task(client, tenant, project, blockerNumber);
      if (!task || !blocker) throw new NotFoundException();
      const removed = await client.query(
        `DELETE FROM task_dependencies
         WHERE organization_id = $1 AND blocker_task_id = $2 AND blocked_task_id = $3`,
        [tenant.organizationId, blocker.id, task.id],
      );
      if (removed.rowCount !== 1) throw new NotFoundException();
      await this.activity.record(client, {
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: task.id,
        actorUserId: userId,
        action: 'dependency.removed',
        changes: { blockedBy: blockerNumber },
        aggregateVersion: task.version,
      });
    });
  }

  async milestones(
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<Milestone[]> {
    const result = await this.database.pool.query<MilestoneRow>(
      `SELECT m.id, m.title, m.due_at, m.status,
         count(t.id) AS task_count,
         count(t.id) FILTER (WHERE t.completed_at IS NOT NULL) AS done_count
       FROM milestones m
       -- Scoped guests only count tasks they can see (ADR-059).
       LEFT JOIN tasks t ON t.milestone_id = m.id AND ${inScope('t.id', '$3')}
       WHERE m.organization_id = $1 AND m.project_id = $2
       GROUP BY m.id
       ORDER BY m.status, m.due_at NULLS LAST, m.title
       LIMIT 200`,
      [tenant.organizationId, project.id, scopeOf(project)],
    );
    return result.rows.map(toMilestone);
  }

  private async milestone(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ) {
    const result = await this.database.pool.query<MilestoneRow>(
      `${MILESTONE_SELECT}
       WHERE m.organization_id = $1 AND m.project_id = $2 AND m.id = $3
       GROUP BY m.id`,
      [tenant.organizationId, project.id, id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return toMilestone(row);
  }

  async createMilestone(
    tenant: TenantContext,
    project: ProjectContext,
    title: string,
    dueAt: string | null,
  ): Promise<Milestone> {
    const result = await this.database.pool.query<{ id: string }>(
      `INSERT INTO milestones (organization_id, project_id, title, due_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenant.organizationId, project.id, title, dueAt],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('milestone insert returned no row');
    return this.milestone(tenant, project, id);
  }

  async updateMilestone(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
    input: {
      title?: string | undefined;
      dueAt?: string | null | undefined;
      status?: Milestone['status'] | undefined;
    },
  ): Promise<Milestone> {
    const result = await this.database.pool.query(
      `UPDATE milestones SET
         title = COALESCE($4, title),
         due_at = CASE WHEN $5 THEN $6::timestamptz ELSE due_at END,
         status = COALESCE($7, status)
       WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [
        tenant.organizationId,
        project.id,
        id,
        input.title ?? null,
        input.dueAt !== undefined,
        input.dueAt ?? null,
        input.status ?? null,
      ],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
    return this.milestone(tenant, project, id);
  }

  /** Tasks keep existing; they simply no longer belong to a milestone. */
  async deleteMilestone(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ): Promise<void> {
    const result = await this.database.pool.query(
      'DELETE FROM milestones WHERE organization_id = $1 AND project_id = $2 AND id = $3',
      [tenant.organizationId, project.id, id],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
  }
}
