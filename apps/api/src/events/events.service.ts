import { Inject, Injectable } from '@nestjs/common';
import type { ProjectEvent } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

/** Most events replayed on reconnect before asking for a full refetch. */
export const REPLAY_LIMIT = 200;

export type Replay =
  | { kind: 'events'; events: ProjectEvent[] }
  | { kind: 'resync' };

@Injectable()
export class EventsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /**
   * Published events after `lastEventId` for this project, oldest first.
   * Ordered by publication time, so an event committed late is still
   * replayed; the boundary is inclusive and the caller drops ids it has
   * already sent. An unknown or pruned cursor, or too many missed events,
   * answers `resync`: the browser refetches instead.
   */
  async replay(
    tenant: TenantContext,
    project: ProjectContext,
    lastEventId: string,
  ): Promise<Replay> {
    const result = await this.database.pool.query<{
      id: string;
      event_type: string;
      aggregate_id: string;
      aggregate_version: string;
      actor: string | null;
      occurred_at: Date;
    }>(
      `WITH cursor AS (
         SELECT published_at FROM outbox_events
         WHERE id = $3 AND organization_id = $1 AND project_id = $2
           AND published_at IS NOT NULL
       )
       SELECT e.id, e.event_type, e.aggregate_id, e.aggregate_version,
              e.payload ->> 'actorUserId' AS actor, e.occurred_at
       FROM outbox_events e, cursor c
       WHERE e.organization_id = $1 AND e.project_id = $2
         AND e.published_at >= c.published_at AND e.id <> $3
       ORDER BY e.published_at, e.id
       LIMIT $4`,
      [tenant.organizationId, project.id, lastEventId, REPLAY_LIMIT + 1],
    );
    if (result.rows.length > REPLAY_LIMIT) return { kind: 'resync' };
    if (result.rows.length === 0) {
      const known = await this.database.pool.query(
        `SELECT 1 FROM outbox_events WHERE id = $3 AND organization_id = $1
           AND project_id = $2 AND published_at IS NOT NULL`,
        [tenant.organizationId, project.id, lastEventId],
      );
      if (!known.rowCount) return { kind: 'resync' };
    }
    return {
      kind: 'events',
      events: result.rows.map((row) => ({
        id: row.id,
        type: row.event_type,
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: row.aggregate_id,
        version: Number(row.aggregate_version),
        actorUserId: row.actor,
        occurredAt: row.occurred_at.toISOString(),
      })),
    };
  }
}
