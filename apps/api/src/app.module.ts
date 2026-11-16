import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { checkDependencies } from '@atlas/shared';
import type { Health } from '@atlas/contracts';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
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
    return { status: 'ok', service: 'api' };
  }
}
@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [HealthController],
})
export class AppModule {}
