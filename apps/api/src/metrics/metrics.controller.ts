import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { metricsAuthorized } from '@atlas/shared';
import type { GaugeReading } from '@atlas/shared';
import { header } from '../auth/http';
import type { HttpRequest } from '../auth/http';
import { DatabaseService } from '../database.service';
import { apiMetrics } from './metrics';

/**
 * Prometheus metrics, readable only with `Authorization: Bearer
 * <METRICS_TOKEN>`; without a configured token the route does not exist.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async metrics(@Req() request: HttpRequest): Promise<string> {
    if (
      !metricsAuthorized(
        header(request, 'authorization'),
        process.env.METRICS_TOKEN,
      )
    )
      throw new NotFoundException();
    const work = await this.database.pool.query<{
      outbox_unpublished: string;
      outbox_lag: number | null;
      unnotified: string;
      webhooks_pending: string;
      attachments_quarantined: string;
      exports_queued: string;
    }>(
      `SELECT
         (SELECT count(*) FROM outbox_events WHERE published_at IS NULL) AS outbox_unpublished,
         (SELECT extract(epoch FROM now() - min(occurred_at)) FROM outbox_events
            WHERE published_at IS NULL) AS outbox_lag,
         (SELECT count(*) FROM outbox_events WHERE notified_at IS NULL) AS unnotified,
         (SELECT count(*) FROM webhook_deliveries WHERE status = 'pending') AS webhooks_pending,
         (SELECT count(*) FROM attachments WHERE status = 'quarantined') AS attachments_quarantined,
         (SELECT count(*) FROM exports WHERE status = 'queued') AS exports_queued`,
    );
    const w = work.rows[0];
    const gauges: GaugeReading[] = [
      {
        name: 'atlas_outbox_unpublished',
        help: 'Outbox events not yet published to Redis.',
        values: [{ value: Number(w?.outbox_unpublished ?? 0) }],
      },
      {
        name: 'atlas_outbox_lag_seconds',
        help: 'Age of the oldest unpublished outbox event (0 when none).',
        values: [{ value: Number(w?.outbox_lag ?? 0) }],
      },
      {
        name: 'atlas_worker_backlog',
        help: 'Work waiting for the worker, by queue.',
        values: [
          {
            labels: { queue: 'notifications' },
            value: Number(w?.unnotified ?? 0),
          },
          {
            labels: { queue: 'webhooks' },
            value: Number(w?.webhooks_pending ?? 0),
          },
          {
            labels: { queue: 'attachment_checks' },
            value: Number(w?.attachments_quarantined ?? 0),
          },
          {
            labels: { queue: 'exports' },
            value: Number(w?.exports_queued ?? 0),
          },
        ],
      },
    ];
    return apiMetrics.render(gauges);
  }
}
