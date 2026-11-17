import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { Usage } from '@atlas/contracts';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { DatabaseService } from '../database.service';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { tenantOf } from '../projects/projects.controller';
import { UsageService } from './usage.service';

const MONTHS = 6;

@Controller('organizations/:slug/usage')
@UseGuards(SessionGuard, TenantGuard)
export class UsageController {
  constructor(
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /** Current size and the last six months of metered usage (ADR-056). */
  @Get()
  @RequirePermission('usage.read')
  async get(@Req() request: HttpRequest): Promise<Usage> {
    const { organizationId } = tenantOf(request);
    // Include this instance's counts that are not yet written.
    await this.usage.flush();
    const size = await this.database.pool.query<{
      members: string;
      guests: string;
      active: string;
      archived: string;
      tasks: string;
      storage: string;
    }>(
      `SELECT
         (SELECT count(*) FROM organization_memberships
          WHERE organization_id = $1 AND state = 'active' AND role <> 'guest') AS members,
         (SELECT count(*) FROM organization_memberships
          WHERE organization_id = $1 AND state = 'active' AND role = 'guest') AS guests,
         (SELECT count(*) FROM projects WHERE organization_id = $1 AND status = 'active') AS active,
         (SELECT count(*) FROM projects WHERE organization_id = $1 AND status = 'archived') AS archived,
         (SELECT count(*) FROM tasks WHERE organization_id = $1) AS tasks,
         (SELECT COALESCE(sum(size_bytes), 0) FROM attachments
          WHERE organization_id = $1 AND status <> 'rejected') AS storage`,
      [organizationId],
    );
    const counters = await this.database.pool.query<{
      period: string;
      metric: string;
      count: string;
    }>(
      `SELECT to_char(period, 'YYYY-MM') AS period, metric, count FROM usage_counters
       WHERE organization_id = $1
         AND period > date_trunc('month', now() AT TIME ZONE 'UTC') - ($2 * interval '1 month')`,
      [organizationId, MONTHS],
    );
    const now = new Date();
    const months = Array.from({ length: MONTHS }, (_, i) => {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
      );
      const period = d.toISOString().slice(0, 7);
      const value = (metric: string) =>
        Number(
          counters.rows.find((r) => r.period === period && r.metric === metric)
            ?.count ?? 0,
        );
      return {
        period,
        apiRequests: value('api_requests'),
        scimRequests: value('scim_requests'),
        webhookDeliveries: value('webhook_deliveries'),
        notificationEmails: value('notification_emails'),
      };
    });
    const row = size.rows[0];
    return {
      members: Number(row?.members ?? 0),
      guests: Number(row?.guests ?? 0),
      projects: {
        active: Number(row?.active ?? 0),
        archived: Number(row?.archived ?? 0),
      },
      tasks: Number(row?.tasks ?? 0),
      storageBytes: Number(row?.storage ?? 0),
      months,
    };
  }
}
