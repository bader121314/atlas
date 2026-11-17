import { Inject, Injectable } from '@nestjs/common';
import type { ProjectEvent } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

/** Most events replayed on reconnect before asking for a full refetch. */
export const REPLAY_LIMIT = 200;

export interface Replay {
  /** Missed events in order, or undefined when the browser must refetch. */
  events?: ProjectEvent[];
}

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
   * returns no events: the stream sends `resync` and the browser refetches.
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
       -- One dispatch batch shares a published_at; keep commit order within it.
       ORDER BY e.published_at, e.occurred_at, e.id
       LIMIT $4`,
      [tenant.organizationId, project.id, lastEventId, REPLAY_LIMIT + 1],
    );
    if (result.rows.length > REPLAY_LIMIT) return {};
    if (result.rows.length === 0) {
      const known = await this.database.pool.query(
        `SELECT 1 FROM outbox_events WHERE id = $3 AND organization_id = $1
           AND project_id = $2 AND published_at IS NOT NULL`,
        [tenant.organizationId, project.id, lastEventId],
      );
      if (!known.rowCount) return {};
    }
    return {
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
