import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { PoolClient } from 'pg';
import type {
  CreateTaskRequest,
  Label,
  Task,
  TaskListResponse,
  TaskQuery,
  UpdateTaskRequest,
  WorkflowState,
} from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { ActivityService } from './activity.service';
import type { Changes } from './activity.service';
import { effectiveProjectRole } from './policy';

interface TaskRow {
  id: string;
  number: number;
  title: string;
  description: string;
  priority: Task['priority'];
  due_at: Date | null;
  completed_at: Date | null;
  version: string;
  created_at: Date;
  updated_at: Date;
  state_id: string;
  state_key: string;
  state_label: string;
  state_category: WorkflowState['category'];
  state_position: number;
  assignee_user_id: string | null;
  assignee_name: string | null;
  parent_number: number | null;
  labels: Label[];
}

const TASK_SELECT = `
  SELECT t.id, t.number, t.title, t.description, t.priority, t.due_at,
    t.completed_at, t.version, t.created_at, t.updated_at,
    s.id AS state_id, s.key AS state_key, s.label AS state_label,
    s.category AS state_category, s.position AS state_position,
    t.assignee_user_id, u.display_name AS assignee_name,
    pt.number AS parent_number,
    COALESCE((
      SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color)
        ORDER BY lower(l.name))
      FROM task_labels tl JOIN labels l ON l.id = tl.label_id
      WHERE tl.task_id = t.id
    ), '[]'::json) AS labels
  FROM tasks t
  JOIN workflow_states s ON s.id = t.state_id
  LEFT JOIN users u ON u.id = t.assignee_user_id
  LEFT JOIN tasks pt ON pt.id = t.parent_task_id`;

function toTask(row: TaskRow, projectKey: string): Task {
  return {
    id: row.id,
    key: `${projectKey}-${row.number}`,
    number: row.number,
    title: row.title,
    description: row.description,
    state: {
      id: row.state_id,
      key: row.state_key,
      label: row.state_label,
      category: row.state_category,
      position: row.state_position,
    },
    priority: row.priority,
    assignee:
      row.assignee_user_id && row.assignee_name
        ? { userId: row.assignee_user_id, displayName: row.assignee_name }
        : null,
    dueAt: row.due_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    parent:
      row.parent_number === null
        ? null
        : {
            number: row.parent_number,
            key: `${projectKey}-${row.parent_number}`,
          },
    labels: row.labels,
    version: Number(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Parent loops and over-deep nesting are client errors, not server errors. */
function rejectInvalidParent(error: unknown): never {
  if (
    error instanceof DatabaseError &&
    (error.constraint === 'tasks_parent_cycle_check' ||
      error.constraint === 'tasks_parent_depth_check' ||
      error.constraint === 'tasks_parent_not_self_check')
  ) {
    throw new BadRequestException();
  }
  throw error;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** Field-level summary of a task edit. Text fields record only that they changed. */
function diff(before: TaskRow, after: TaskRow): Changes {
  const changes: Changes = {};
  const pairs: [string, string | null, string | null][] = [
    ['state', before.state_key, after.state_key],
    ['priority', before.priority, after.priority],
    ['assignee', before.assignee_user_id, after.assignee_user_id],
    ['dueAt', iso(before.due_at), iso(after.due_at)],
    [
      'parent',
      before.parent_number === null ? null : String(before.parent_number),
      after.parent_number === null ? null : String(after.parent_number),
    ],
    [
      'labels',
      before.labels.map((l) => l.name).join(', ') || null,
      after.labels.map((l) => l.name).join(', ') || null,
    ],
  ];
  for (const [field, from, to] of pairs) {
    if (from !== to) changes[field] = { from, to };
  }
  if (before.title !== after.title) changes.title = true;
  if (before.description !== after.description) changes.description = true;
  return changes;
}

/**
 * Tasks are always addressed through (organization, project) resolved by
 * the guards; every query filters on both.
 */
@Injectable()
export class TasksService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  async states(
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<WorkflowState[]> {
    const result = await this.database.pool.query<WorkflowState>(
      `SELECT id, key, label, category, position FROM workflow_states
       WHERE organization_id = $1 AND project_id = $2
       ORDER BY position`,
      [tenant.organizationId, project.id],
    );
    return result.rows;
  }

  async list(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    query: TaskQuery,
  ): Promise<TaskListResponse> {
    const conditions = ['t.organization_id = $1', 't.project_id = $2'];
    const values: unknown[] = [tenant.organizationId, project.id];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };
    if (query.state) add('s.key = ?', query.state);
    if (query.assignee === 'none')
      conditions.push('t.assignee_user_id IS NULL');
    else if (query.assignee === 'me') add('t.assignee_user_id = ?', userId);
    else if (query.assignee) add('t.assignee_user_id = ?', query.assignee);
    if (query.priority) add('t.priority = ?', query.priority);
    if (query.label) {
      add(
        'EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_id = ?)',
        query.label,
      );
    }
    if (query.parent === 'none') conditions.push('t.parent_task_id IS NULL');
    else if (query.parent !== undefined) add('pt.number = ?', query.parent);
    if (query.after !== undefined) add('t.number > ?', query.after);
    values.push(query.limit + 1);
    const result = await this.database.pool.query<TaskRow>(
      `${TASK_SELECT}
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.number
       LIMIT $${values.length}`,
      values,
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      tasks: rows.map((row) => toTask(row, project.key)),
      nextCursor: result.rows.length > query.limit && last ? last.number : null,
    };
  }

  async get(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<Task> {
    const row = await this.find(this.database.pool, tenant, project, number);
    if (!row) throw new NotFoundException();
    return toTask(row, project.key);
  }

  async create(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    input: CreateTaskRequest,
  ): Promise<Task> {
    return this.database.transaction(async (client) => {
      const counter = await client.query<{ number: number }>(
        `UPDATE projects SET next_task_number = next_task_number + 1
         WHERE organization_id = $1 AND id = $2 AND status = 'active'
         RETURNING next_task_number - 1 AS number`,
        [tenant.organizationId, project.id],
      );
      const number = counter.rows[0]?.number;
      // Archived projects are read-only.
      if (number === undefined) throw new ConflictException();
      const stateId = input.stateId
        ? await this.requireState(client, tenant, project, input.stateId)
        : await this.firstState(client, tenant, project);
      if (input.assigneeId) {
        await this.requireAssignable(client, tenant, project, input.assigneeId);
      }
      const parentId =
        input.parentNumber === null
          ? null
          : await this.requireParent(
              client,
              tenant,
              project,
              input.parentNumber,
            );
      const category = await this.categoryOf(client, stateId);
      await client
        .query(
          `INSERT INTO tasks (organization_id, project_id, number, title,
           description, state_id, priority, assignee_user_id, due_at,
           completed_at, created_by_user_id, parent_task_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
           CASE WHEN $10 THEN now() END, $11, $12)`,
          [
            tenant.organizationId,
            project.id,
            number,
            input.title,
            input.description,
            stateId,
            input.priority,
            input.assigneeId,
            input.dueAt,
            category === 'done',
            userId,
            parentId,
          ],
        )
        .catch(rejectInvalidParent);
      const row = await this.find(client, tenant, project, number);
      if (!row) throw new Error('task vanished after insert');
      await this.activity.record(client, {
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: row.id,
        actorUserId: userId,
        action: 'task.created',
        changes: { number, state: row.state_key, priority: row.priority },
        aggregateVersion: 1,
      });
      return toTask(row, project.key);
    });
  }

  /**
   * Applies only the fields sent; `null` clears assignee or due date. The
   * version must match the stored one, otherwise 409.
   */
  async update(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    userId: string,
    input: UpdateTaskRequest,
  ): Promise<Task> {
    return this.database.transaction(async (client) => {
      await this.requireActiveProject(client, tenant, project);
      const current = await client.query<{
        state_id: string;
        version: string;
        completed_at: Date | null;
      }>(
        `SELECT state_id, version, completed_at FROM tasks
         WHERE organization_id = $1 AND project_id = $2 AND number = $3
         FOR UPDATE`,
        [tenant.organizationId, project.id, number],
      );
      const task = current.rows[0];
      if (!task) throw new NotFoundException();
      if (Number(task.version) !== input.version) throw new ConflictException();
      const before = await this.find(client, tenant, project, number);
      const stateId = input.stateId
        ? await this.requireState(client, tenant, project, input.stateId)
        : task.state_id;
      if (input.assigneeId) {
        await this.requireAssignable(client, tenant, project, input.assigneeId);
      }
      const parentId =
        input.parentNumber === undefined || input.parentNumber === null
          ? null
          : await this.requireParent(
              client,
              tenant,
              project,
              input.parentNumber,
            );
      const done = (await this.categoryOf(client, stateId)) === 'done';
      await client
        .query(
          `UPDATE tasks SET
           title = COALESCE($4, title),
           description = COALESCE($5, description),
           state_id = $6,
           priority = COALESCE($7, priority),
           assignee_user_id = CASE WHEN $8 THEN $9::uuid ELSE assignee_user_id END,
           due_at = CASE WHEN $10 THEN $11::timestamptz ELSE due_at END,
           parent_task_id = CASE WHEN $13 THEN $14::uuid ELSE parent_task_id END,
           completed_at = CASE
             WHEN $12 THEN COALESCE(completed_at, now())
             ELSE NULL END,
           version = version + 1,
           updated_at = now()
         WHERE organization_id = $1 AND project_id = $2 AND number = $3`,
          [
            tenant.organizationId,
            project.id,
            number,
            input.title ?? null,
            input.description ?? null,
            stateId,
            input.priority ?? null,
            input.assigneeId !== undefined,
            input.assigneeId ?? null,
            input.dueAt !== undefined,
            input.dueAt ?? null,
            done,
            input.parentNumber !== undefined,
            parentId,
          ],
        )
        .catch(rejectInvalidParent);
      const row = await this.find(client, tenant, project, number);
      if (!row || !before) throw new Error('task vanished after update');
      const changes = diff(before, row);
      await this.activity.record(client, {
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: row.id,
        actorUserId: userId,
        action: 'task.updated',
        changes,
        aggregateVersion: Number(row.version),
      });
      return toTask(row, project.key);
    });
  }

  private async find(
    runner: Pick<PoolClient, 'query'>,
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<TaskRow | undefined> {
    const result = await runner.query<TaskRow>(
      `${TASK_SELECT}
       WHERE t.organization_id = $1 AND t.project_id = $2 AND t.number = $3`,
      [tenant.organizationId, project.id, number],
    );
    return result.rows[0];
  }

  private async requireActiveProject(
    client: PoolClient,
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM projects
       WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
      [tenant.organizationId, project.id],
    );
    if (!result.rowCount) throw new ConflictException();
  }

  /** A parent must be another task in the same project. */
  private async requireParent(
    client: PoolClient,
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM tasks
       WHERE organization_id = $1 AND project_id = $2 AND number = $3`,
      [tenant.organizationId, project.id, number],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new BadRequestException();
    return id;
  }

  /**
   * Replaces a task's labels. Labels must belong to the organization; the
   * change bumps the task version and is recorded like any other edit.
   */
  async setLabels(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    userId: string,
    labelIds: string[],
  ): Promise<Task> {
    const unique = [...new Set(labelIds)];
    return this.database.transaction(async (client) => {
      await this.requireActiveProject(client, tenant, project);
      const before = await this.find(client, tenant, project, number);
      if (!before) throw new NotFoundException();
      await client.query('SELECT 1 FROM tasks WHERE id = $1 FOR UPDATE', [
        before.id,
      ]);
      const owned = await client.query(
        'SELECT 1 FROM labels WHERE organization_id = $1 AND id = ANY($2::uuid[])',
        [tenant.organizationId, unique],
      );
      if (owned.rowCount !== unique.length) throw new BadRequestException();
      await client.query(
        'DELETE FROM task_labels WHERE organization_id = $1 AND task_id = $2',
        [tenant.organizationId, before.id],
      );
      if (unique.length > 0) {
        await client.query(
          `INSERT INTO task_labels (organization_id, task_id, label_id)
           SELECT $1, $2, unnest($3::uuid[])`,
          [tenant.organizationId, before.id, unique],
        );
      }
      await client.query(
        `UPDATE tasks SET version = version + 1, updated_at = now()
         WHERE organization_id = $1 AND id = $2`,
        [tenant.organizationId, before.id],
      );
      const row = await this.find(client, tenant, project, number);
      if (!row) throw new Error('task vanished after labeling');
      await this.activity.record(client, {
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: row.id,
        actorUserId: userId,
        action: 'task.updated',
        changes: diff(before, row),
        aggregateVersion: Number(row.version),
      });
      return toTask(row, project.key);
    });
  }

  /** The state must belong to this project; anything else is a bad request. */
  private async requireState(
    client: PoolClient,
    tenant: TenantContext,
    project: ProjectContext,
    stateId: string,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM workflow_states
       WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [tenant.organizationId, project.id, stateId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new BadRequestException();
    return id;
  }

  private async firstState(
    client: PoolClient,
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM workflow_states
       WHERE organization_id = $1 AND project_id = $2
       ORDER BY position LIMIT 1`,
      [tenant.organizationId, project.id],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('project has no workflow states');
    return id;
  }

  private async categoryOf(
    client: PoolClient,
    stateId: string,
  ): Promise<string> {
    const result = await client.query<{ category: string }>(
      'SELECT category FROM workflow_states WHERE id = $1',
      [stateId],
    );
    return result.rows[0]?.category ?? 'todo';
  }

  /** Assignees must be active members who can see the project. */
  private async requireAssignable(
    client: PoolClient,
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
  ): Promise<void> {
    const result = await client.query<{
      role: string;
      visibility: string;
      explicit_role: string | null;
    }>(
      `SELECT om.role, p.visibility, pm.role AS explicit_role
       FROM organization_memberships om
       JOIN projects p ON p.organization_id = om.organization_id AND p.id = $3
       LEFT JOIN project_memberships pm
         ON pm.project_id = p.id AND pm.user_id = om.user_id
       WHERE om.organization_id = $1 AND om.user_id = $2
         AND om.state = 'active'`,
      [tenant.organizationId, userId, project.id],
    );
    const row = result.rows[0];
    const role = row
      ? effectiveProjectRole(
          row.role,
          row.visibility,
          row.explicit_role ?? undefined,
        )
      : undefined;
    if (!role) throw new BadRequestException();
  }
}
