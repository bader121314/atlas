import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { TenantGuard } from './tenant.guard';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, RateLimitModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, TenantGuard],
  exports: [OrganizationsService, TenantGuard],
})
export class OrganizationsModule {}
