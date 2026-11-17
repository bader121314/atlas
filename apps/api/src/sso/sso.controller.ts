import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Put,
  Query,
  Redirect,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ssoCallbackQuerySchema,
  ssoConnectionRequestSchema,
  ssoStartQuerySchema,
  parseRequest,
} from '@atlas/contracts';
import type { SsoConnection } from '@atlas/contracts';
import { caller, parse, requestMeta } from '../auth/auth.controller';
import { SESSION_TTL_SECONDS } from '../auth/auth.service';
import { sessionCookie } from '../auth/cookies';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest, HttpResponse } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { tenantOf } from '../projects/projects.controller';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { SsoService } from './sso.service';

@Controller('organizations/:slug/sso')
@UseGuards(SessionGuard, TenantGuard)
export class SsoSettingsController {
  constructor(@Inject(SsoService) private readonly sso: SsoService) {}

  @Get()
  @RequirePermission('domains.manage')
  get(@Req() request: HttpRequest): Promise<SsoConnection> {
    return this.sso.get(tenantOf(request));
  }

  @Put()
  @RequirePermission('domains.manage')
  async put(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<SsoConnection> {
    const result = await this.sso.put(
      tenantOf(request),
      caller(request).user.id,
      parse(ssoConnectionRequestSchema, body),
      requestMeta(request),
    );
    if (typeof result === 'string') throw new BadRequestException(result);
    return result;
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission('domains.manage')
  remove(@Req() request: HttpRequest): Promise<void> {
    return this.sso.remove(
      tenantOf(request),
      caller(request).user.id,
      requestMeta(request),
    );
  }
}

/** Browser redirects; failures return to the sign-in page with a reason. */
@Controller('auth/sso')
export class SsoLoginController {
  constructor(
    @Inject(SsoService) private readonly sso: SsoService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Get('start')
  @Redirect()
  async start(
    @Query() query: unknown,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<{ url: string; statusCode: number }> {
    await this.limits.consume([
      { rule: 'loginPerIp', subject: request.ip ?? 'unknown' },
    ]);
    response.setHeader('Cache-Control', 'no-store');
    const input = parseRequest(ssoStartQuerySchema, query);
    const url = input ? await this.sso.start(input.email) : undefined;
    return {
      url: url ?? `${this.sso.webOrigin()}/login/sso?error=unavailable`,
      statusCode: 302,
    };
  }

  @Get('callback')
  @Redirect()
  async callback(
    @Query() query: unknown,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<{ url: string; statusCode: number }> {
    await this.limits.consume([
      { rule: 'loginPerIp', subject: request.ip ?? 'unknown' },
    ]);
    response.setHeader('Cache-Control', 'no-store');
    const input = parseRequest(ssoCallbackQuerySchema, query);
    if (!input) throw new NotFoundException();
    const outcome = await this.sso.callback(
      input.state,
      input.code,
      requestMeta(request),
    );
    if (!outcome.ok)
      return {
        url: `${this.sso.webOrigin()}/login/sso?error=${outcome.reason}`,
        statusCode: 302,
      };
    response.setHeader(
      'Set-Cookie',
      sessionCookie(outcome.token, SESSION_TTL_SECONDS),
    );
    return {
      url: `${this.sso.webOrigin()}/organizations/${outcome.slug}`,
      statusCode: 302,
    };
  }
}
