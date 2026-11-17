import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { capacityRequestSchema, workloadQuerySchema } from '@atlas/contracts';
import type { Workload } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { idParam, tenantOf } from '../projects/projects.controller';
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

  @Put('capacity/:userId')
  @RequirePermission('members.read')
  capacity(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<{ userId: string; weeklyMinutes: number | null }> {
    return this.workload.setCapacity(
      tenantOf(request),
      caller(request).user.id,
      idParam(userId),
      parse(capacityRequestSchema, body).weeklyMinutes,
    );
  }
}
