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
  createAutomationRequestSchema,
  simulateAutomationRequestSchema,
  updateAutomationRequestSchema,
} from '@atlas/contracts';
import type { AutomationRule } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { AutomationsService } from './automations.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';

@Controller('organizations/:slug/projects/:key/automations')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class AutomationsController {
  constructor(
    @Inject(AutomationsService)
    private readonly automations: AutomationsService,
  ) {}

  @Get()
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  list(@Req() request: HttpRequest): Promise<AutomationRule[]> {
    return this.automations.list(tenantOf(request), projectOf(request));
  }

  @Post()
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  create(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<AutomationRule> {
    return this.automations.create(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      parse(createAutomationRequestSchema, body),
    );
  }

  @Post('simulate')
  @HttpCode(200)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  simulate(@Body() body: unknown, @Req() request: HttpRequest) {
    return this.automations.simulate(
      tenantOf(request),
      projectOf(request),
      parse(simulateAutomationRequestSchema, body).conditions,
    );
  }

  @Patch(':id')
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<AutomationRule> {
    return this.automations.update(
      tenantOf(request),
      projectOf(request),
      idParam(id),
      parse(updateAutomationRequestSchema, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  remove(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.automations.remove(
      tenantOf(request),
      projectOf(request),
      idParam(id),
    );
  }

  @Get(':id/runs')
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  runs(@Param('id') id: string, @Req() request: HttpRequest) {
    return this.automations.runs(
      tenantOf(request),
      projectOf(request),
      idParam(id),
    );
  }
}
