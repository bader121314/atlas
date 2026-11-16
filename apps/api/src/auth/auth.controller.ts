import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  loginRequestSchema,
  parseRequest,
  resendVerificationRequestSchema,
  signupRequestSchema,
  verifyEmailRequestSchema,
} from '@atlas/contracts';
import type { SessionResponse } from '@atlas/contracts';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { AuthService, SESSION_TTL_SECONDS } from './auth.service';
import { clearedSessionCookie, sessionCookie } from './cookies';
import { SessionGuard } from './guards';
import { header } from './http';
import type { AuthContext, HttpRequest, HttpResponse } from './http';

function parse<T>(
  schema: Parameters<typeof parseRequest<T>>[0],
  body: unknown,
): T {
  const value = parseRequest(schema, body);
  if (value === undefined) throw new BadRequestException();
  return value;
}

function clientIp(request: HttpRequest): string {
  return request.ip ?? 'unknown';
}

function caller(request: HttpRequest): AuthContext {
  if (!request.auth) throw new UnauthorizedException();
  return request.auth;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Post('signup')
  @HttpCode(202)
  async signup(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    await this.limits.consume([
      { rule: 'signupPerIp', subject: clientIp(request) },
    ]);
    await this.auth.signup(parse(signupRequestSchema, body));
  }

  @Post('resend-verification')
  @HttpCode(202)
  async resendVerification(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    const { email } = parse(resendVerificationRequestSchema, body);
    await this.limits.consume([
      { rule: 'resendPerIp', subject: clientIp(request) },
      { rule: 'resendPerAccount', subject: email },
    ]);
    await this.auth.resendVerification(email);
  }

  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    await this.limits.consume([
      { rule: 'verifyPerIp', subject: clientIp(request) },
    ]);
    const { token } = parse(verifyEmailRequestSchema, body);
    if (!(await this.auth.verifyEmail(token))) {
      throw new BadRequestException();
    }
  }

  @Post('login')
  @HttpCode(204)
  async login(
    @Body() body: unknown,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    const input = parse(loginRequestSchema, body);
    await this.limits.consume([
      { rule: 'loginPerIp', subject: clientIp(request) },
      { rule: 'loginPerAccount', subject: input.email },
    ]);
    const result = await this.auth.login(input, header(request, 'user-agent'));
    if (!result.ok) throw new UnauthorizedException();
    response.setHeader(
      'Set-Cookie',
      sessionCookie(result.token, SESSION_TTL_SECONDS),
    );
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    await this.auth.revoke(caller(request).sessionId);
    response.setHeader('Set-Cookie', clearedSessionCookie());
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@Req() request: HttpRequest): SessionResponse {
    return { user: caller(request).user };
  }
}
