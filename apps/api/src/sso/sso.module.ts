import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { SsoLoginController, SsoSettingsController } from './sso.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    RateLimitModule,
  ],
  controllers: [SsoSettingsController, SsoLoginController],
  providers: [SsoService],
})
export class SsoModule {}
