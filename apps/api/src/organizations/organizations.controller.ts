import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createOrganizationRequestSchema,
  updateOrganizationRequestSchema,
} from '@atlas/contracts';
import type {
  MemberListResponse,
  Organization,
  OrganizationListResponse,
} from '@atlas/contracts';
import { caller, parse, requestMeta } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest, TenantContext } from '../auth/http';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { OrganizationsService } from './organizations.service';
import { RequirePermission, TenantGuard } from './tenant.guard';

function tenantOf(request: HttpRequest): TenantContext {
  if (!request.tenant) throw new Error('TenantGuard did not run');
  return request.tenant;
}

/**
 * The organization is chosen by the slug in the URL, so "switching" is just
 * navigating to another organization's URL; there is no server-side current
 * organization to fall out of sync.
 */
@Controller('organizations')
@UseGuards(SessionGuard)
export class OrganizationsController {
  constructor(
    @Inject(OrganizationsService)
    private readonly organizations: OrganizationsService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Organization> {
    const input = parse(createOrganizationRequestSchema, body);
    const { user } = caller(request);
    await this.limits.consume([
      { rule: 'orgCreatePerAccount', subject: user.id },
    ]);
    return this.organizations.create(user.id, input, requestMeta(request));
  }

  @Get()
  list(@Req() request: HttpRequest): Promise<OrganizationListResponse> {
    return this.organizations.listForUser(caller(request).user.id);
  }

  @Get(':slug')
  @UseGuards(TenantGuard)
  @RequirePermission('organization.read')
  get(@Req() request: HttpRequest): Promise<Organization> {
    return this.organizations.get(tenantOf(request));
  }

  @Patch(':slug')
  @UseGuards(TenantGuard)
  @RequirePermission('organization.update')
  update(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Organization> {
    const { name } = parse(updateOrganizationRequestSchema, body);
    return this.organizations.rename(
      tenantOf(request),
      caller(request).user.id,
      name,
      requestMeta(request),
    );
  }

  @Get(':slug/members')
  @UseGuards(TenantGuard)
  @RequirePermission('members.read')
  members(@Req() request: HttpRequest): Promise<MemberListResponse> {
    return this.organizations.listMembers(tenantOf(request));
  }
}
