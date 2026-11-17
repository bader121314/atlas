import { Inject, Injectable } from '@nestjs/common';
import type { ProjectAnalytics } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

export const WEEKS = 8;

/** Middle value of a sorted list; undefined when empty. */
export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Project numbers computed directly from tasks with SQL (ADR-033), so they
 * always agree with the task lists. Weeks start on Monday, in UTC.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async project(
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<ProjectAnalytics> {
    const args = [tenant.organizationId, project.id];
    const [states, totals, weeks, lead, people] = await Promise.all([
      this.database.pool.query<{
        id: string;
        label: string;
        category: string;
        count: string;
      }>(
        `SELECT ws.id, ws.label, ws.category, count(t.id) AS count
         FROM workflow_states ws
         LEFT JOIN tasks t ON t.state_id = ws.id AND t.organization_id = $1
         WHERE ws.organization_id = $1 AND ws.project_id = $2
         GROUP BY ws.id ORDER BY ws.position`,
        args,
      ),
      this.database.pool.query<{
        total: string;
        done: string;
        overdue: string;
        unassigned: string;
      }>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE ws.category = 'done') AS done,
                count(*) FILTER (WHERE ws.category <> 'done' AND t.due_at < now()) AS overdue,
                count(*) FILTER (WHERE ws.category <> 'done' AND t.assignee_user_id IS NULL) AS unassigned
         FROM tasks t JOIN workflow_states ws ON ws.id = t.state_id
         WHERE t.organization_id = $1 AND t.project_id = $2`,
        args,
      ),
      this.database.pool.query<{
        week: string;
        created: string;
        completed: string;
      }>(
        `WITH weeks AS (
           SELECT generate_series(
             date_trunc('week', now() AT TIME ZONE 'UTC') - interval '${WEEKS - 1} weeks',
             date_trunc('week', now() AT TIME ZONE 'UTC'),
             interval '1 week') AS week
         )
         SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
           (SELECT count(*) FROM tasks t WHERE t.organization_id = $1 AND t.project_id = $2
              AND (t.created_at AT TIME ZONE 'UTC') >= w.week
              AND (t.created_at AT TIME ZONE 'UTC') < w.week + interval '1 week') AS created,
           (SELECT count(*) FROM tasks t WHERE t.organization_id = $1 AND t.project_id = $2
              AND (t.completed_at AT TIME ZONE 'UTC') >= w.week
              AND (t.completed_at AT TIME ZONE 'UTC') < w.week + interval '1 week') AS completed
         FROM weeks w ORDER BY w.week`,
        args,
      ),
      this.database.pool.query<{ days: number }>(
        `SELECT extract(epoch FROM t.completed_at - t.created_at) / 86400 AS days
         FROM tasks t JOIN workflow_states ws ON ws.id = t.state_id
         WHERE t.organization_id = $1 AND t.project_id = $2
           AND ws.category = 'done' AND t.completed_at > now() - interval '90 days'`,
        args,
      ),
      this.database.pool.query<{
        user_id: string;
        display_name: string;
        open: string;
      }>(
        `SELECT u.id AS user_id, u.display_name, count(*) AS open
         FROM tasks t
         JOIN workflow_states ws ON ws.id = t.state_id
         JOIN users u ON u.id = t.assignee_user_id
         WHERE t.organization_id = $1 AND t.project_id = $2 AND ws.category <> 'done'
         GROUP BY u.id ORDER BY count(*) DESC, u.display_name LIMIT 20`,
        args,
      ),
    ]);
    const total = totals.rows[0];
    const leadDays = median(lead.rows.map((r) => Number(r.days)));
    return {
      total: Number(total?.total ?? 0),
      done: Number(total?.done ?? 0),
      overdue: Number(total?.overdue ?? 0),
      unassigned: Number(total?.unassigned ?? 0),
      byState: states.rows.map((r) => ({
        stateId: r.id,
        label: r.label,
        category: r.category as ProjectAnalytics['byState'][number]['category'],
        count: Number(r.count),
      })),
      weeks: weeks.rows.map((r) => ({
        weekStart: r.week,
        created: Number(r.created),
        completed: Number(r.completed),
      })),
      medianLeadDays:
        leadDays === undefined ? null : Math.round(leadDays * 10) / 10,
      openByAssignee: people.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        open: Number(r.open),
      })),
    };
  }
}
