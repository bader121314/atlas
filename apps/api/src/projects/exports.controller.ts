import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { TaskExport } from '@atlas/contracts';
import { caller } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { ExportsService } from './exports.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';

@Controller('organizations/:slug/projects/:key/exports')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class ExportsController {
  constructor(
    @Inject(ExportsService) private readonly exports: ExportsService,
  ) {}

  @Post()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.export')
  request(@Req() request: HttpRequest): Promise<TaskExport> {
    return this.exports.request(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
    );
  }

  @Get()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.export')
  list(@Req() request: HttpRequest): Promise<TaskExport[]> {
    return this.exports.list(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
    );
  }

  @Get(':id/download')
  @Redirect()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.export')
  async download(
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<{ url: string; statusCode: number }> {
    const project = projectOf(request);
    return {
      url: await this.exports.downloadUrl(
        tenantOf(request),
        project,
        caller(request).user.id,
        idParam(id),
        project.key,
      ),
      statusCode: 302,
    };
  }
}
