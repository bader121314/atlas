import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { logTimeRequestSchema, timeReportQuerySchema } from '@atlas/contracts';
import type { TaskTime, TimeEntry, TimeReport } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { taskNumber } from './tasks.controller';
import { TimeService } from './time.service';

@Controller('organizations/:slug/projects/:key/tasks/:number/time')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class TaskTimeController {
  constructor(@Inject(TimeService) private readonly time: TimeService) {}

  @Get()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  list(
    @Param('number') number: string,
    @Req() request: HttpRequest,
  ): Promise<TaskTime> {
    return this.time.list(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
    );
  }

  @Post()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  log(
    @Param('number') number: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<TimeEntry> {
    return this.time.log(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      caller(request).user.id,
      parse(logTimeRequestSchema, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  remove(
    @Param('number') number: string,
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.time.remove(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      idParam(id),
      caller(request).user.id,
    );
  }
}

@Controller('organizations/:slug/time')
@UseGuards(SessionGuard, TenantGuard)
export class TimeReportController {
  constructor(@Inject(TimeService) private readonly time: TimeService) {}

  @Get()
  @RequirePermission('organization.read')
  report(
    @Query() query: unknown,
    @Req() request: HttpRequest,
  ): Promise<TimeReport> {
    const range = parse(timeReportQuerySchema, query);
    return this.time.report(
      tenantOf(request),
      caller(request).user.id,
      range.from,
      range.to,
    );
  }
}
