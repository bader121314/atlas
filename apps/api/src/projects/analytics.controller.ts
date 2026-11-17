import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { ProjectAnalytics } from '@atlas/contracts';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { AnalyticsService } from './analytics.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { projectOf, tenantOf } from './projects.controller';

@Controller('organizations/:slug/projects/:key/analytics')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  @Get()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  get(@Req() request: HttpRequest): Promise<ProjectAnalytics> {
    return this.analytics.project(tenantOf(request), projectOf(request));
  }
}
