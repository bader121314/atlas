import { Inject, Injectable } from '@nestjs/common';
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
    }>(
      `WITH readable AS (
         SELECT p.id FROM projects p
         LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
         WHERE p.organization_id = $1 AND p.status = 'active'
           AND ($3 IN ('owner', 'admin') OR pm.user_id IS NOT NULL
                OR ($3 = 'member' AND p.visibility = 'organization'))
       ),
       open AS (
         SELECT a.user_id, t.due_at
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
         count(*) AS count
       FROM open o JOIN users u ON u.id = o.user_id
       GROUP BY o.user_id, u.display_name, bucket`,
      [tenant.organizationId, userId, tenant.role, weeks],
    );
    const people = new Map<string, Workload['people'][number]>();
    for (const row of rows.rows) {
      const person = people.get(row.user_id) ?? {
        userId: row.user_id,
        displayName: row.display_name,
        overdue: 0,
        weeks: weekStarts.map(() => 0),
        later: 0,
        noDueDate: 0,
        total: 0,
      };
      const count = Number(row.count);
      if (row.bucket === 'overdue') person.overdue += count;
      else if (row.bucket === 'later') person.later += count;
      else if (row.bucket === 'none') person.noDueDate += count;
      else {
        const index = weekStarts.indexOf(row.bucket);
        if (index >= 0)
          person.weeks[index] = (person.weeks[index] ?? 0) + count;
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
}
