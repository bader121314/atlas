import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createApiTokenRequestSchema } from '@atlas/contracts';
import type { ApiToken } from '@atlas/contracts';
import { caller, parse, requestMeta } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { idParam, tenantOf } from '../projects/projects.controller';
import { ApiTokensService } from './api-tokens.service';

/** Token management needs a signed-in browser, and guests cannot use tokens. */
function sessionMember(request: HttpRequest) {
  if (request.auth?.token) throw new ForbiddenException();
  const tenant = tenantOf(request);
  if (tenant.role === 'guest') throw new ForbiddenException();
  return tenant;
}

@Controller('organizations/:slug/api-tokens')
@UseGuards(SessionGuard, TenantGuard)
export class ApiTokensController {
  constructor(
    @Inject(ApiTokensService) private readonly tokens: ApiTokensService,
  ) {}

  @Get()
  @RequirePermission('organization.read')
  list(@Req() request: HttpRequest): Promise<ApiToken[]> {
    return this.tokens.list(sessionMember(request), caller(request).user.id);
  }

  @Post()
  @RequirePermission('organization.read')
  async create(@Body() body: unknown, @Req() request: HttpRequest) {
    const created = await this.tokens.create(
      sessionMember(request),
      caller(request).user.id,
      parse(createApiTokenRequestSchema, body),
      requestMeta(request),
    );
    if (!created) throw new ConflictException();
    return created;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  revoke(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.tokens.revoke(
      sessionMember(request),
      caller(request).user.id,
      idParam(id),
      requestMeta(request),
    );
  }
}
