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
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createFieldRequestSchema,
  setFieldValueRequestSchema,
  updateFieldRequestSchema,
} from '@atlas/contracts';
import type { CustomField } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { FieldsService } from './fields.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { idParam, projectOf, tenantOf } from './projects.controller';
import { taskNumber } from './tasks.controller';

@Controller('organizations/:slug/projects/:key')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class FieldsController {
  constructor(@Inject(FieldsService) private readonly fields: FieldsService) {}

  @Get('fields')
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  list(@Req() request: HttpRequest): Promise<CustomField[]> {
    return this.fields.list(tenantOf(request), projectOf(request));
  }

  @Post('fields')
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  create(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<CustomField> {
    return this.fields.create(
      tenantOf(request),
      projectOf(request),
      parse(createFieldRequestSchema, body),
    );
  }

  @Patch('fields/:id')
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<CustomField> {
    return this.fields.update(
      tenantOf(request),
      projectOf(request),
      idParam(id),
      parse(updateFieldRequestSchema, body),
    );
  }

  @Delete('fields/:id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  remove(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.fields.remove(
      tenantOf(request),
      projectOf(request),
      idParam(id),
    );
  }

  @Put('tasks/:number/fields/:id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.write')
  setValue(
    @Param('number') number: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.fields.setValue(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      idParam(id),
      caller(request).user.id,
      parse(setFieldValueRequestSchema, body).value,
    );
  }
}
