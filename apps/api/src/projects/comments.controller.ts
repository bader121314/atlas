import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { commentBodySchema } from '@atlas/contracts';
import type { Activity, Comment } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { CommentsService } from './comments.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { taskNumber } from './tasks.controller';

@Controller('organizations/:slug/projects/:key/tasks/:number')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class CommentsController {
  constructor(
    @Inject(CommentsService) private readonly comments: CommentsService,
  ) {}

  @Get('comments')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  list(
    @Param('number') number: string,
    @Req() request: HttpRequest,
  ): Promise<Comment[]> {
    return this.comments.list(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
    );
  }

  @Post('comments')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.comment')
  create(
    @Param('number') number: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Comment> {
    return this.comments.create(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      caller(request).user.id,
      parse(commentBodySchema, body).body,
    );
  }

  @Patch('comments/:id')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.comment')
  edit(
    @Param('number') number: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Comment> {
    return this.comments.change(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      idParam(id),
      caller(request).user.id,
      parse(commentBodySchema, body).body,
    );
  }

  @Delete('comments/:id')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.comment')
  remove(
    @Param('number') number: string,
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<Comment> {
    return this.comments.change(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      idParam(id),
      caller(request).user.id,
      null,
    );
  }

  @Get('activity')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  activity(
    @Param('number') number: string,
    @Req() request: HttpRequest,
  ): Promise<Activity[]> {
    return this.comments.history(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
    );
  }
}
