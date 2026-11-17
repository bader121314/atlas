import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createStateRequestSchema,
  deleteStateQuerySchema,
  parseRequest,
  reorderStatesRequestSchema,
  updateStateRequestSchema,
} from '@atlas/contracts';
import type { WorkflowState } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { StatesService } from './states.service';

@Controller('organizations/:slug/projects/:key/states')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class StatesController {
  constructor(@Inject(StatesService) private readonly states: StatesService) {}

  @Post()
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  create(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<WorkflowState> {
    const input = parse(createStateRequestSchema, body);
    return this.states.create(
      tenantOf(request),
      projectOf(request),
      input.label,
      input.category,
    );
  }

  @Put('order')
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  reorder(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<WorkflowState[]> {
    return this.states.reorder(
      tenantOf(request),
      projectOf(request),
      parse(reorderStatesRequestSchema, body).stateIds,
    );
  }

  @Patch(':id')
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<WorkflowState> {
    return this.states.update(
      tenantOf(request),
      projectOf(request),
      idParam(id),
      parse(updateStateRequestSchema, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  remove(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    const parsed = parseRequest(deleteStateQuerySchema, query);
    if (!parsed) throw new BadRequestException();
    return this.states.remove(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      idParam(id),
      parsed.moveTo,
    );
  }
}
