import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createProjectRequestSchema,
  parseRequest,
  resourceIdSchema,
  setProjectMemberRequestSchema,
  updateProjectRequestSchema,
} from '@atlas/contracts';
import type {
  Project,
  ProjectListResponse,
  ProjectMemberListResponse,
} from '@atlas/contracts';
import { caller, parse, requestMeta } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest, ProjectContext, TenantContext } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { ProjectsService } from './projects.service';

export function tenantOf(request: HttpRequest): TenantContext {
  if (!request.tenant) throw new Error('TenantGuard did not run');
  return request.tenant;
}

export function projectOf(request: HttpRequest): ProjectContext {
  if (!request.project) throw new Error('ProjectGuard did not run');
  return request.project;
}

export function idParam(value: string): string {
  const id = parseRequest(resourceIdSchema, value);
  if (!id) throw new NotFoundException();
  return id;
}

@Controller('organizations/:slug/projects')
@UseGuards(SessionGuard, TenantGuard)
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  @Get()
  @RequirePermission('organization.read')
  list(@Req() request: HttpRequest): Promise<ProjectListResponse> {
    return this.projects.list(tenantOf(request), caller(request).user.id);
  }

  @Post()
  @RequirePermission('projects.create')
  create(@Body() body: unknown, @Req() request: HttpRequest): Promise<Project> {
    return this.projects.create(
      tenantOf(request),
      caller(request).user.id,
      parse(createProjectRequestSchema, body),
      requestMeta(request),
    );
  }

  @Get(':key')
  @UseGuards(ProjectGuard)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.read')
  get(@Req() request: HttpRequest): Promise<Project> {
    return this.projects.get(tenantOf(request), projectOf(request));
  }

  @Patch(':key')
  @UseGuards(ProjectGuard)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  update(@Body() body: unknown, @Req() request: HttpRequest): Promise<Project> {
    return this.projects.update(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      parse(updateProjectRequestSchema, body),
      requestMeta(request),
    );
  }

  @Get(':key/members')
  @UseGuards(ProjectGuard)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.read')
  members(@Req() request: HttpRequest): Promise<ProjectMemberListResponse> {
    return this.projects.listMembers(tenantOf(request), projectOf(request));
  }

  @Put(':key/members/:userId')
  @HttpCode(204)
  @UseGuards(ProjectGuard)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.members.manage')
  setMember(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    const { role, labelIds } = parse(setProjectMemberRequestSchema, body);
    return this.projects.setMember(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      idParam(userId),
      role,
      requestMeta(request),
      labelIds,
    );
  }

  @Delete(':key/members/:userId')
  @HttpCode(204)
  @UseGuards(ProjectGuard)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.members.manage')
  removeMember(
    @Param('userId') userId: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.projects.removeMember(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      idParam(userId),
      requestMeta(request),
    );
  }
}
