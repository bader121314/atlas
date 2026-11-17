import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  createShareLinkRequestSchema,
  shareTokenSchema,
} from '@atlas/contracts';
import type { ShareLink, SharedProject } from '@atlas/contracts';
import { caller, parse, requestMeta } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest, HttpResponse } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import {
  ProjectGuard,
  RequireProjectPermission,
} from '../projects/project.guard';
import { idParam, projectOf, tenantOf } from '../projects/projects.controller';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { SharesService } from './shares.service';

@Controller('organizations/:slug/projects/:key/share-links')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class ShareLinksController {
  constructor(@Inject(SharesService) private readonly shares: SharesService) {}

  @Get()
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  list(@Req() request: HttpRequest): Promise<ShareLink[]> {
    return this.shares.list(tenantOf(request), projectOf(request));
  }

  @Post()
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  async create(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<{ link: ShareLink; token: string }> {
    const input = parse(createShareLinkRequestSchema, body ?? {});
    const created = await this.shares.create(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      input.expiresInDays,
      requestMeta(request),
    );
    if (!created)
      throw new ConflictException('A project can have at most 10 public links');
    return created;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('project.update')
  revoke(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.shares.revoke(
      tenantOf(request),
      projectOf(request),
      caller(request).user.id,
      idParam(id),
      requestMeta(request),
    );
  }
}

/** Unauthenticated: anyone with the token. Every failure is the same 404. */
@Controller('public/shares')
export class PublicSharesController {
  constructor(
    @Inject(SharesService) private readonly shares: SharesService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Get(':token')
  async get(
    @Param('token') token: string,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<SharedProject> {
    await this.limits.consume([
      { rule: 'sharePerIp', subject: request.ip ?? 'unknown' },
    ]);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!shareTokenSchema.safeParse(token).success)
      throw new NotFoundException();
    const shared = await this.shares.resolve(token);
    if (!shared) throw new NotFoundException();
    return shared;
  }
}
