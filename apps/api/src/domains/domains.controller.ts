import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { addDomainRequestSchema } from '@atlas/contracts';
import type { OrganizationDomain } from '@atlas/contracts';
import { caller, parse, requestMeta } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { idParam, tenantOf } from '../projects/projects.controller';
import { DomainsService } from './domains.service';

@Controller('organizations/:slug/domains')
@UseGuards(SessionGuard, TenantGuard)
export class DomainsController {
  constructor(
    @Inject(DomainsService) private readonly domains: DomainsService,
  ) {}

  @Get()
  @RequirePermission('domains.manage')
  list(@Req() request: HttpRequest): Promise<OrganizationDomain[]> {
    return this.domains.list(tenantOf(request));
  }

  @Post()
  @RequirePermission('domains.manage')
  add(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<OrganizationDomain> {
    return this.domains.add(
      tenantOf(request),
      caller(request).user.id,
      parse(addDomainRequestSchema, body).domain,
      requestMeta(request),
    );
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('domains.manage')
  verify(
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<OrganizationDomain> {
    return this.domains.verify(
      tenantOf(request),
      caller(request).user.id,
      idParam(id),
      requestMeta(request),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('domains.manage')
  remove(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.domains.remove(
      tenantOf(request),
      caller(request).user.id,
      idParam(id),
      requestMeta(request),
    );
  }
}
