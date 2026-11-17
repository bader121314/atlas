import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { checkDependencies } from '@atlas/shared';
import type { Health } from '@atlas/contracts';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database.module';
import { MetricsController } from './metrics/metrics.controller';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProjectsModule } from './projects/projects.module';
import { ScimModule } from './scim/scim.module';
import { UsageModule } from './usage/usage.module';
import { DomainsModule } from './domains/domains.module';
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
  imports: [
    UsageModule,
    DomainsModule,
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    ScimModule,
    DatabaseModule,
  ],
  controllers: [HealthController, MetricsController],
})
export class AppModule {}
