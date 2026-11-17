import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateRecurrenceRequest, Recurrence } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

const MAX_RECURRENCES = 50;

interface Row {
  id: string;
  title: string;
  priority: Recurrence['priority'];
  assignee_user_id: string | null;
  frequency: Recurrence['frequency'];
  interval: number;
  due_in_days: number | null;
  next_run_at: Date;
  last_run_at: Date | null;
  enabled: boolean;
}

const COLUMNS = `id, title, priority, assignee_user_id, frequency, interval, due_in_days,
  next_run_at, last_run_at, enabled`;

function toRecurrence(row: Row): Recurrence {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    assigneeId: row.assignee_user_id,
    frequency: row.frequency,
    interval: row.interval,
    dueInDays: row.due_in_days,
    nextRunAt: row.next_run_at.toISOString(),
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    enabled: row.enabled,
  };
}

/** Recurring tasks (ADR-039); the worker creates each occurrence. */
@Injectable()
export class RecurrencesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<Recurrence[]> {
    const result = await this.database.pool.query<Row>(
      `SELECT ${COLUMNS} FROM task_recurrences
       WHERE organization_id = $1 AND project_id = $2 ORDER BY next_run_at`,
      [tenant.organizationId, project.id],
    );
    return result.rows.map(toRecurrence);
  }

  async create(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    input: CreateRecurrenceRequest,
  ): Promise<Recurrence> {
    if (input.assigneeId) {
      const ok = await this.database.pool.query(
        `SELECT 1 FROM organization_memberships m
         JOIN projects p ON p.organization_id = m.organization_id AND p.id = $3
         LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = m.user_id
         WHERE m.organization_id = $1 AND m.user_id = $2 AND m.state = 'active'
           AND (m.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL
                OR (m.role = 'member' AND p.visibility = 'organization'))`,
        [tenant.organizationId, input.assigneeId, project.id],
      );
      if (!ok.rowCount)
        throw new BadRequestException('The assignee cannot open this project');
    }
    const count = await this.database.pool.query<{ count: string }>(
      'SELECT count(*) FROM task_recurrences WHERE organization_id = $1 AND project_id = $2',
      [tenant.organizationId, project.id],
    );
    if (Number(count.rows[0]?.count) >= MAX_RECURRENCES)
      throw new BadRequestException('Recurring task limit reached');
    const result = await this.database.pool.query<Row>(
      `INSERT INTO task_recurrences (organization_id, project_id, title, description, priority,
         assignee_user_id, frequency, interval, due_in_days, next_run_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()), $11)
       RETURNING ${COLUMNS}`,
      [
        tenant.organizationId,
        project.id,
        input.title,
        input.description,
        input.priority,
        input.assigneeId,
        input.frequency,
        input.interval,
        input.dueInDays,
        input.startsAt ?? null,
        userId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('recurrence insert returned no row');
    return toRecurrence(row);
  }

  async setEnabled(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
    enabled: boolean,
  ): Promise<Recurrence> {
    const result = await this.database.pool.query<Row>(
      `UPDATE task_recurrences SET enabled = $4
       WHERE organization_id = $1 AND project_id = $2 AND id = $3 RETURNING ${COLUMNS}`,
      [tenant.organizationId, project.id, id, enabled],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return toRecurrence(row);
  }

  async remove(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ): Promise<void> {
    const result = await this.database.pool.query(
      'DELETE FROM task_recurrences WHERE organization_id = $1 AND project_id = $2 AND id = $3',
      [tenant.organizationId, project.id, id],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
  }
}
