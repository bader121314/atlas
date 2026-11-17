import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createLabelRequestSchema,
  setTaskLabelsRequestSchema,
} from '@atlas/contracts';
import type { Label, Task } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { LabelsService } from './labels.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { taskNumber } from './tasks.controller';
import { TasksService } from './tasks.service';

@Controller('organizations/:slug/labels')
@UseGuards(SessionGuard, TenantGuard)
export class LabelsController {
  constructor(@Inject(LabelsService) private readonly labels: LabelsService) {}

  @Get()
  @RequirePermission('organization.read')
  list(@Req() request: HttpRequest): Promise<Label[]> {
    return this.labels.list(tenantOf(request));
  }

  @Post()
  @RequirePermission('labels.manage')
  create(@Body() body: unknown, @Req() request: HttpRequest): Promise<Label> {
    const input = parse(createLabelRequestSchema, body);
    return this.labels.create(tenantOf(request), input.name, input.color);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('labels.delete')
  remove(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.labels.remove(tenantOf(request), idParam(id));
  }
}

@Controller('organizations/:slug/projects/:key/tasks/:number/labels')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class TaskLabelsController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Put()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  set(
    @Param('number') number: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Task> {
    return this.tasks.setLabels(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      caller(request).user.id,
      parse(setTaskLabelsRequestSchema, body).labelIds,
    );
  }
}
