import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createTaskRequestSchema,
  parseRequest,
  taskQuerySchema,
  updateTaskRequestSchema,
} from '@atlas/contracts';
import type { Task, TaskListResponse, WorkflowState } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { projectOf, tenantOf } from './projects.controller';
import { TasksService } from './tasks.service';

export function taskNumber(value: string): number {
  const number = /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number)) throw new NotFoundException();
  return number;
}

@Controller('organizations/:slug/projects/:key')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get('states')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  states(@Req() request: HttpRequest): Promise<WorkflowState[]> {
    return this.tasks.states(tenantOf(request), projectOf(request));
  }

  @Get('tasks')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  list(
    @Query() query: unknown,
    @Req() request: HttpRequest,
  ): Promise<TaskListResponse> {
    const parsed = parseRequest(taskQuerySchema, query);
    if (!parsed) throw new BadRequestException();
    return this.tasks.list(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      parsed,
    );
  }

  @Post('tasks')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  create(@Body() body: unknown, @Req() request: HttpRequest): Promise<Task> {
    return this.tasks.create(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      parse(createTaskRequestSchema, body),
    );
  }

  @Get('tasks/:number')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  get(
    @Param('number') number: string,
    @Req() request: HttpRequest,
  ): Promise<Task> {
    return this.tasks.get(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
    );
  }

  @Patch('tasks/:number')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  update(
    @Param('number') number: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Task> {
    return this.tasks.update(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      caller(request).user.id,
      parse(updateTaskRequestSchema, body),
    );
  }
}
