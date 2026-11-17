import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { DatabaseService } from '../database.service';

export type ApiUsageMetric = 'api_requests' | 'scim_requests';

const FLUSH_MS = 5000;

/**
 * Counts metered requests (ADR-056). Counting must never slow or fail a
 * request, so counts collect in memory and are written in one statement
 * every few seconds and at shutdown.
 */
@Injectable()
export class UsageService implements OnApplicationShutdown {
  private readonly logger = new Logger(UsageService.name);
  private pending = new Map<string, number>();
  private readonly timer = setInterval(() => void this.flush(), FLUSH_MS);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.timer.unref();
  }

  count(organizationId: string, metric: ApiUsageMetric): void {
    const key = `${organizationId}|${metric}`;
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
  }

  /** Writes collected counts; on failure they are kept for the next try. */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    const organizations: string[] = [];
    const metrics: string[] = [];
    const amounts: number[] = [];
    for (const [key, amount] of batch) {
      const [organizationId = '', metric = ''] = key.split('|');
      organizations.push(organizationId);
      metrics.push(metric);
      amounts.push(amount);
    }
    try {
      await this.database.pool.query(
        `INSERT INTO usage_counters (organization_id, period, metric, count)
         SELECT o, date_trunc('month', now() AT TIME ZONE 'UTC')::date, m, a
         FROM unnest($1::uuid[], $2::text[], $3::bigint[]) AS u(o, m, a)
         ON CONFLICT (organization_id, period, metric)
           DO UPDATE SET count = usage_counters.count + EXCLUDED.count`,
        [organizations, metrics, amounts],
      );
    } catch {
      for (const [key, amount] of batch)
        this.pending.set(key, (this.pending.get(key) ?? 0) + amount);
      this.logger.error('usage counts could not be written; will retry');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
