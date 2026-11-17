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
  dependencyRequestSchema,
  milestoneRequestSchema,
  updateMilestoneRequestSchema,
} from '@atlas/contracts';
import type { DependenciesResponse, Milestone } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { PlanningService } from './planning.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { taskNumber } from './tasks.controller';

@Controller('organizations/:slug/projects/:key')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class PlanningController {
  constructor(
    @Inject(PlanningService) private readonly planning: PlanningService,
  ) {}

  @Get('tasks/:number/dependencies')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  dependencies(
    @Param('number') number: string,
    @Req() request: HttpRequest,
  ): Promise<DependenciesResponse> {
    return this.planning.dependencies(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
    );
  }

  @Post('tasks/:number/dependencies')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  addDependency(
    @Param('number') number: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.planning.addDependency(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      parse(dependencyRequestSchema, body).blockerNumber,
      caller(request).user.id,
    );
  }

  @Delete('tasks/:number/dependencies/:blocker')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  removeDependency(
    @Param('number') number: string,
    @Param('blocker') blocker: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.planning.removeDependency(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      taskNumber(blocker),
      caller(request).user.id,
    );
  }

  @Get('milestones')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  milestones(@Req() request: HttpRequest): Promise<Milestone[]> {
    return this.planning.milestones(tenantOf(request), projectOf(request));
  }

  @Post('milestones')
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  createMilestone(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Milestone> {
    const input = parse(milestoneRequestSchema, body);
    return this.planning.createMilestone(
      tenantOf(request),
      projectOf(request),
      input.title,
      input.dueAt,
    );
  }

  @Patch('milestones/:id')
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  updateMilestone(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Milestone> {
    return this.planning.updateMilestone(
      tenantOf(request),
      projectOf(request),
      idParam(id),
      parse(updateMilestoneRequestSchema, body),
    );
  }

  @Delete('milestones/:id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  deleteMilestone(
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.planning.deleteMilestone(
      tenantOf(request),
      projectOf(request),
      idParam(id),
    );
  }
}
