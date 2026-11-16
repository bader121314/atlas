import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { InvitationsController, MembersController } from './members.controller';
import { MembershipsService } from './memberships.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { TenantGuard } from './tenant.guard';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, RateLimitModule],
  controllers: [
    OrganizationsController,
    MembersController,
    InvitationsController,
  ],
  providers: [OrganizationsService, MembershipsService, TenantGuard],
  exports: [OrganizationsService, TenantGuard],
})
export class OrganizationsModule {}
