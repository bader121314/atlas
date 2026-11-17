import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createAttachmentRequestSchema } from '@atlas/contracts';
import type { Attachment } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { AttachmentsService } from './attachments.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { taskNumber } from './tasks.controller';

@Controller('organizations/:slug/projects/:key')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class AttachmentsController {
  constructor(
    @Inject(AttachmentsService)
    private readonly attachments: AttachmentsService,
  ) {}

  @Get('tasks/:number/attachments')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  list(
    @Param('number') number: string,
    @Req() request: HttpRequest,
  ): Promise<Attachment[]> {
    return this.attachments.list(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
    );
  }

  @Post('tasks/:number/attachments')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  create(
    @Param('number') number: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ) {
    return this.attachments.create(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      caller(request).user.id,
      parse(createAttachmentRequestSchema, body),
    );
  }

  @Post('attachments/:id/complete')
  @HttpCode(200)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  complete(
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<Attachment> {
    return this.attachments.complete(
      tenantOf(request),
      projectOf(request),
      idParam(id),
      caller(request).user.id,
    );
  }

  @Get('attachments/:id/download')
  @Redirect()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  async download(
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<{ url: string; statusCode: number }> {
    return {
      url: await this.attachments.downloadUrl(
        tenantOf(request),
        projectOf(request),
        idParam(id),
      ),
      statusCode: 302,
    };
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  remove(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.attachments.remove(
      tenantOf(request),
      projectOf(request),
      idParam(id),
      caller(request).user.id,
    );
  }
}
