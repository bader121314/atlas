import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LogTimeRequest,
  TaskTime,
  TimeEntry,
  TimeReport,
} from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

interface EntryRow {
  id: string;
  user_id: string;
  display_name: string;
  minutes: number;
  spent_on: string;
  note: string | null;
  created_at: Date;
}

const ENTRY_COLUMNS = `e.id, e.user_id, u.display_name, e.minutes,
  to_char(e.spent_on, 'YYYY-MM-DD') AS spent_on, e.note, e.created_at`;

function toEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    user: { userId: row.user_id, displayName: row.display_name },
    minutes: row.minutes,
    spentOn: row.spent_on,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Time tracking (ADR-049). Editors log their own time on tasks; the author
 * or a project manager can remove an entry. Reports only cover projects the
 * caller can read, and only owners and admins see other people's time.
 */
@Injectable()
export class TimeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private async taskId(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<string> {
    const result = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM tasks
       WHERE organization_id = $1 AND project_id = $2 AND number = $3`,
      [tenant.organizationId, project.id, number],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new NotFoundException();
    return id;
  }

  async list(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<TaskTime> {
    const taskId = await this.taskId(tenant, project, number);
    const result = await this.database.pool.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS}
       FROM time_entries e JOIN users u ON u.id = e.user_id
       WHERE e.organization_id = $1 AND e.task_id = $2
       ORDER BY e.spent_on DESC, e.created_at DESC
       LIMIT 500`,
      [tenant.organizationId, taskId],
    );
    const total = await this.database.pool.query<{ total: string }>(
      `SELECT COALESCE(sum(minutes), 0) AS total FROM time_entries
       WHERE organization_id = $1 AND task_id = $2`,
      [tenant.organizationId, taskId],
    );
    return {
      totalMinutes: Number(total.rows[0]?.total ?? 0),
      entries: result.rows.map(toEntry),
    };
  }

  async log(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    userId: string,
    input: LogTimeRequest,
  ): Promise<TimeEntry> {
    // A day of slack covers people ahead of UTC.
    if (Date.parse(input.spentOn) > Date.now() + 86_400_000)
      throw new BadRequestException('Time cannot be logged for future days');
    const taskId = await this.taskId(tenant, project, number);
    const result = await this.database.pool.query<EntryRow>(
      `WITH e AS (
         INSERT INTO time_entries (organization_id, project_id, task_id, user_id,
           minutes, spent_on, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *)
       SELECT ${ENTRY_COLUMNS} FROM e JOIN users u ON u.id = e.user_id`,
      [
        tenant.organizationId,
        project.id,
        taskId,
        userId,
        input.minutes,
        input.spentOn,
        input.note || null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('time entry insert returned no row');
    return toEntry(row);
  }

  async remove(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    entryId: string,
    userId: string,
  ): Promise<void> {
    const taskId = await this.taskId(tenant, project, number);
    const found = await this.database.pool.query<{ user_id: string }>(
      `SELECT user_id FROM time_entries
       WHERE organization_id = $1 AND task_id = $2 AND id = $3`,
      [tenant.organizationId, taskId, entryId],
    );
    const entry = found.rows[0];
    if (!entry) throw new NotFoundException();
    if (entry.user_id !== userId && project.role !== 'manager')
      throw new ForbiddenException();
    await this.database.pool.query(
      `DELETE FROM time_entries WHERE organization_id = $1 AND id = $2`,
      [tenant.organizationId, entryId],
    );
  }

  async report(
    tenant: TenantContext,
    userId: string,
    from: string,
    to: string,
  ): Promise<TimeReport> {
    const everyone = tenant.role === 'owner' || tenant.role === 'admin';
    const result = await this.database.pool.query<{
      user_id: string;
      display_name: string;
      key: string;
      name: string;
      minutes: string;
    }>(
      `WITH readable AS (
         SELECT p.id FROM projects p
         LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
         WHERE p.organization_id = $1
           AND ($3::text IN ('owner', 'admin') OR pm.user_id IS NOT NULL
                OR ($3::text = 'member' AND p.visibility = 'organization'))
       )
       SELECT e.user_id, u.display_name, p.key, p.name, sum(e.minutes) AS minutes
       FROM time_entries e
       JOIN readable r ON r.id = e.project_id
       JOIN projects p ON p.id = e.project_id
       JOIN users u ON u.id = e.user_id
       WHERE e.organization_id = $1 AND e.spent_on BETWEEN $4::date AND $5::date
         AND ($6::boolean OR e.user_id = $2)
       GROUP BY e.user_id, u.display_name, p.key, p.name
       ORDER BY u.display_name, p.key`,
      [tenant.organizationId, userId, tenant.role, from, to, everyone],
    );
    const rows = result.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      projectKey: r.key,
      projectName: r.name,
      minutes: Number(r.minutes),
    }));
    return {
      from,
      to,
      everyone,
      totalMinutes: rows.reduce((sum, r) => sum + r.minutes, 0),
      rows,
    };
  }
}
