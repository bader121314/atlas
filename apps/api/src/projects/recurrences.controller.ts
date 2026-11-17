import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createRecurrenceRequestSchema,
  setEnabledRequestSchema,
} from '@atlas/contracts';
import type { Recurrence } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { RecurrencesService } from './recurrences.service';

@Controller('organizations/:slug/projects/:key/recurrences')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class RecurrencesController {
  constructor(
    @Inject(RecurrencesService)
    private readonly recurrences: RecurrencesService,
  ) {}

  @Get()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  list(@Req() request: HttpRequest): Promise<Recurrence[]> {
    return this.recurrences.list(tenantOf(request), projectOf(request));
  }

  @Post()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  create(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Recurrence> {
    return this.recurrences.create(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      parse(createRecurrenceRequestSchema, body),
    );
  }

  @Patch(':id')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Recurrence> {
    return this.recurrences.setEnabled(
      tenantOf(request),
      projectOf(request),
      idParam(id),
      parse(setEnabledRequestSchema, body).enabled,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  remove(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.recurrences.remove(
      tenantOf(request),
      projectOf(request),
      idParam(id),
    );
  }
}
