import { Inject, Injectable } from '@nestjs/common';
import { toCsv } from '@atlas/shared';
import type { AuditEventView, AuditPage } from '@atlas/contracts';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

const MAX_EXPORT_ROWS = 100_000;

interface Row {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_name: string | null;
  target_type: string | null;
  target_id: string | null;
  ip_summary: string | null;
  user_agent_summary: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

const COLUMNS = `e.id, e.action, e.actor_user_id, u.display_name AS actor_name,
  e.target_type, e.target_id, e.ip_summary, e.user_agent_summary, e.request_id,
  e.metadata, e.occurred_at`;

function toView(row: Row): AuditEventView {
  return {
    id: row.id,
    action: row.action,
    actor:
      row.actor_user_id === null
        ? null
        : {
            userId: row.actor_user_id,
            displayName: row.actor_name ?? 'Deleted account',
          },
    target:
      row.target_type === null || row.target_id === null
        ? null
        : { type: row.target_type, id: row.target_id },
    ipSummary: row.ip_summary,
    userAgent: row.user_agent_summary,
    requestId: row.request_id,
    metadata: row.metadata,
    occurredAt: row.occurred_at.toISOString(),
  };
}

/**
 * Reading and exporting an organization's audit log (ADR-051). Only events
 * recorded against this organization are visible; account events such as
 * sign-ins belong to the person, not the organization.
 */
@Injectable()
export class AuditLogService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async page(
    tenant: TenantContext,
    query: {
      action?: string | undefined;
      before?: string | undefined;
      limit: number;
    },
  ): Promise<AuditPage> {
    const result = await this.database.pool.query<Row>(
      `SELECT ${COLUMNS}
       FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.organization_id = $1
         AND ($2::text IS NULL OR e.action = $2::text OR starts_with(e.action, $2::text || '.'))
         AND ($3::uuid IS NULL OR (e.occurred_at, e.id) < (
           SELECT b.occurred_at, b.id FROM audit_events b
           WHERE b.organization_id = $1 AND b.id = $3::uuid))
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT $4`,
      [
        tenant.organizationId,
        query.action ?? null,
        query.before ?? null,
        query.limit + 1,
      ],
    );
    const rows = result.rows.slice(0, query.limit);
    return {
      items: rows.map(toView),
      nextBefore:
        result.rows.length > query.limit
          ? (rows[rows.length - 1]?.id ?? null)
          : null,
    };
  }

  /** CSV of every event in the range (whole UTC days), oldest first. */
  async exportCsv(
    tenant: TenantContext,
    from: string,
    to: string,
  ): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const result = await this.database.pool.query<Row>(
      `SELECT ${COLUMNS}
       FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.organization_id = $1
         AND e.occurred_at >= ($2::date)::timestamp AT TIME ZONE 'UTC'
         AND e.occurred_at < ($3::date + 1)::timestamp AT TIME ZONE 'UTC'
       ORDER BY e.occurred_at, e.id
       LIMIT $4`,
      [tenant.organizationId, from, to, MAX_EXPORT_ROWS + 1],
    );
    const rows = result.rows.slice(0, MAX_EXPORT_ROWS);
    const csv = toCsv([
      [
        'Time (UTC)',
        'Action',
        'Actor id',
        'Actor',
        'Target type',
        'Target id',
        'Network',
        'Client',
        'Request id',
        'Details',
      ],
      ...rows.map((r) => [
        r.occurred_at.toISOString(),
        r.action,
        r.actor_user_id,
        r.actor_name,
        r.target_type,
        r.target_id,
        r.ip_summary,
        r.user_agent_summary,
        r.request_id,
        JSON.stringify(r.metadata),
      ]),
    ]);
    return {
      csv,
      rows: rows.length,
      truncated: result.rows.length > MAX_EXPORT_ROWS,
    };
  }
}
