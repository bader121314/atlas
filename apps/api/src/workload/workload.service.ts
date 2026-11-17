import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Workload } from '@atlas/contracts';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

/**
 * Open work per person per week across the projects the caller can read
 * (ADR-047). Tasks in projects the caller cannot open are never counted, so
 * the totals cannot reveal private work.
 */
@Injectable()
export class WorkloadService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async organization(
    tenant: TenantContext,
    userId: string,
    weeks: number,
  ): Promise<Workload> {
    const starts = await this.database.pool.query<{ week: string }>(
      `SELECT to_char(generate_series(
         date_trunc('week', now() AT TIME ZONE 'UTC'),
         date_trunc('week', now() AT TIME ZONE 'UTC') + ($1 - 1) * interval '1 week',
         interval '1 week'), 'YYYY-MM-DD') AS week`,
      [weeks],
    );
    const weekStarts = starts.rows.map((r) => r.week);
    const rows = await this.database.pool.query<{
      user_id: string;
      display_name: string;
      bucket: string;
      count: string;
      minutes: string;
    }>(
      `WITH readable AS (
         SELECT p.id FROM projects p
         LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
         WHERE p.organization_id = $1 AND p.status = 'active'
           AND ($3 IN ('owner', 'admin') OR pm.user_id IS NOT NULL
                OR ($3 = 'member' AND p.visibility = 'organization'))
       ),
       open AS (
         SELECT a.user_id, t.due_at,
           -- An estimate is shared equally between assignees (ADR-054).
           t.estimate_minutes::numeric
             / (SELECT count(*) FROM task_assignees a2 WHERE a2.task_id = t.id) AS share
         FROM tasks t
         JOIN readable r ON r.id = t.project_id
         JOIN workflow_states s ON s.id = t.state_id AND s.category <> 'done'
         JOIN task_assignees a ON a.task_id = t.id
         WHERE t.organization_id = $1
       )
       SELECT o.user_id, u.display_name,
         CASE
           WHEN o.due_at IS NULL THEN 'none'
           WHEN o.due_at < date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN 'overdue'
           WHEN o.due_at >= (date_trunc('week', now() AT TIME ZONE 'UTC') + $4 * interval '1 week') AT TIME ZONE 'UTC' THEN 'later'
           ELSE to_char(date_trunc('week', o.due_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
         END AS bucket,
         count(*) AS count,
         round(COALESCE(sum(o.share), 0)) AS minutes
       FROM open o JOIN users u ON u.id = o.user_id
       GROUP BY o.user_id, u.display_name, bucket`,
      [tenant.organizationId, userId, tenant.role, weeks],
    );
    // Everyone with a capacity appears, even with nothing assigned.
    const capacities = await this.database.pool.query<{
      user_id: string;
      display_name: string;
      weekly_capacity_minutes: number | null;
    }>(
      `SELECT m.user_id, u.display_name, m.weekly_capacity_minutes
       FROM organization_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.state = 'active'`,
      [tenant.organizationId],
    );
    const capacity = new Map(
      capacities.rows.map((r) => [r.user_id, r.weekly_capacity_minutes]),
    );
    const people = new Map<string, Workload['people'][number]>();
    const blank = (id: string, name: string): Workload['people'][number] => ({
      userId: id,
      displayName: name,
      overdue: 0,
      weeks: weekStarts.map(() => 0),
      weekMinutes: weekStarts.map(() => 0),
      capacityMinutes: capacity.get(id) ?? null,
      later: 0,
      noDueDate: 0,
      total: 0,
    });
    for (const r of capacities.rows)
      if (r.weekly_capacity_minutes !== null)
        people.set(r.user_id, blank(r.user_id, r.display_name));
    for (const row of rows.rows) {
      const person =
        people.get(row.user_id) ?? blank(row.user_id, row.display_name);
      const count = Number(row.count);
      if (row.bucket === 'overdue') person.overdue += count;
      else if (row.bucket === 'later') person.later += count;
      else if (row.bucket === 'none') person.noDueDate += count;
      else {
        const index = weekStarts.indexOf(row.bucket);
        if (index >= 0) {
          person.weeks[index] = (person.weeks[index] ?? 0) + count;
          person.weekMinutes[index] =
            (person.weekMinutes[index] ?? 0) + Number(row.minutes);
        }
      }
      person.total += count;
      people.set(row.user_id, person);
    }
    return {
      weekStarts,
      people: [...people.values()].sort(
        (a, b) =>
          b.total - a.total || a.displayName.localeCompare(b.displayName),
      ),
    };
  }

  /**
   * Sets someone's weekly capacity in this organization (ADR-054). People
   * set their own; owners and admins set anyone's.
   */
  async setCapacity(
    tenant: TenantContext,
    callerId: string,
    userId: string,
    minutes: number | null,
  ): Promise<{ userId: string; weeklyMinutes: number | null }> {
    if (
      callerId !== userId &&
      tenant.role !== 'owner' &&
      tenant.role !== 'admin'
    )
      throw new ForbiddenException();
    const result = await this.database.pool.query(
      `UPDATE organization_memberships SET weekly_capacity_minutes = $3
       WHERE organization_id = $1 AND user_id = $2 AND state = 'active'`,
      [tenant.organizationId, userId, minutes],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
    return { userId, weeklyMinutes: minutes };
  }
}
