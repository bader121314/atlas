import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createViewRequestSchema } from '@atlas/contracts';
import type { SavedView } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { ViewsService } from './views.service';

@Controller('organizations/:slug/projects/:key/views')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class ViewsController {
  constructor(@Inject(ViewsService) private readonly views: ViewsService) {}

  @Get()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  list(@Req() request: HttpRequest): Promise<SavedView[]> {
    return this.views.list(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
    );
  }

  @Post()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  create(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<SavedView> {
    return this.views.create(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      parse(createViewRequestSchema, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  remove(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.views.remove(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      idParam(id),
    );
  }
}
