import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { checkDependencies } from '@atlas/shared';
import type { Health } from '@atlas/contracts';
import { OutboxService } from './outbox/outbox.service';
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
@Module({ controllers: [HealthController], providers: [OutboxService] })
export class AppModule {}
