import {
  Controller,
  Get,
  Header,
  Headers,
  Module,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { checkDependencies, metricsAuthorized } from '@atlas/shared';
import type { Health } from '@atlas/contracts';
import { AttachmentChecksService } from './attachments/attachments.service';
import { AutomationsService } from './automations/automations.service';
import { DomainChecksService } from './domains/domains.service';
import { NotificationsService } from './notifications/notifications.service';
import { workerMetrics } from './metrics';
import { OutboxService } from './outbox/outbox.service';
import { WebhooksService } from './webhooks/webhooks.service';
@Controller('health')
export class HealthController {
  @Get('ready') async ready(): Promise<Health> {
    try {
      await checkDependencies();
      return this.live();
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  @Get('live') live(): Health {
    return { status: 'ok', service: 'worker' };
  }
}
@Controller('metrics')
export class MetricsController {
  /** Prometheus metrics with `Authorization: Bearer <METRICS_TOKEN>`. */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(@Headers('authorization') authorization?: string): string {
    if (!metricsAuthorized(authorization, process.env.METRICS_TOKEN))
      throw new NotFoundException();
    return workerMetrics.render();
  }
}
@Module({
  controllers: [HealthController, MetricsController],
  providers: [
    OutboxService,
    NotificationsService,
    AttachmentChecksService,
    WebhooksService,
    AutomationsService,
    DomainChecksService,
  ],
})
export class AppModule {}
