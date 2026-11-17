import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { scimBody } from './scim-body';
import { ScimTokensController } from './scim-tokens.controller';
import { ScimTokensService } from './scim-tokens.service';
import { ScimController } from './scim.controller';
import { ScimGuard } from './scim.guard';
import { ScimService } from './scim.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    RateLimitModule,
  ],
  controllers: [ScimController, ScimTokensController],
  providers: [ScimService, ScimTokensService, ScimGuard],
})
export class ScimModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(scimBody)
      .forRoutes({ path: 'scim/*path', method: RequestMethod.ALL });
  }
}
