import {
  ConflictException,
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
import type { ScimToken } from '@atlas/contracts';
import { caller, requestMeta } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { idParam, tenantOf } from '../projects/projects.controller';
import { ScimTokensService } from './scim-tokens.service';

@Controller('organizations/:slug/scim-tokens')
@UseGuards(SessionGuard, TenantGuard)
export class ScimTokensController {
  constructor(
    @Inject(ScimTokensService) private readonly tokens: ScimTokensService,
  ) {}

  @Get()
  @RequirePermission('scim.manage')
  list(@Req() request: HttpRequest): Promise<ScimToken[]> {
    return this.tokens.list(tenantOf(request));
  }

  @Post()
  @RequirePermission('scim.manage')
  async create(
    @Req() request: HttpRequest,
  ): Promise<{ token: ScimToken; secret: string }> {
    const created = await this.tokens.create(
      tenantOf(request),
      caller(request).user.id,
      requestMeta(request),
    );
    if (!created)
      throw new ConflictException('At most two SCIM tokens; revoke one first');
    return created;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('scim.manage')
  revoke(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.tokens.revoke(
      tenantOf(request),
      caller(request).user.id,
      idParam(id),
      requestMeta(request),
    );
  }
}
