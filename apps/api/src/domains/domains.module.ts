import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DomainResolver } from './domain-resolver';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';

/** Global so provisioning and SSO can check verified domains. */
@Global()
@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, OrganizationsModule],
  controllers: [DomainsController],
  providers: [DomainsService, DomainResolver],
  exports: [DomainsService],
})
export class DomainsModule {}
