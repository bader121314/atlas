import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { workloadQuerySchema } from '@atlas/contracts';
import type { Workload } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { tenantOf } from '../projects/projects.controller';
import { WorkloadService } from './workload.service';

@Controller('organizations/:slug/workload')
@UseGuards(SessionGuard, TenantGuard)
export class WorkloadController {
  constructor(
    @Inject(WorkloadService) private readonly workload: WorkloadService,
  ) {}

  @Get()
  @RequirePermission('members.read')
  get(@Query() query: unknown, @Req() request: HttpRequest): Promise<Workload> {
    return this.workload.organization(
      tenantOf(request),
      caller(request).user.id,
      parse(workloadQuerySchema, query).weeks,
    );
  }
}
