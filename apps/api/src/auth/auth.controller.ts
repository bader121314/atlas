import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  parseRequest,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  resendVerificationRequestSchema,
  signupRequestSchema,
  verifyEmailRequestSchema,
} from '@atlas/contracts';
import type { SessionResponse } from '@atlas/contracts';
import type { RequestMeta } from '../audit/audit.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { AuthService, SESSION_TTL_SECONDS } from './auth.service';
import { clearedSessionCookie, sessionCookie } from './cookies';
import { SessionGuard } from './guards';
import { header } from './http';
import type { AuthContext, HttpRequest, HttpResponse } from './http';

export function parse<T>(
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

export function requestMeta(request: HttpRequest): RequestMeta {
  return {
    ip: request.ip,
    userAgent: header(request, 'user-agent'),
    requestId: request.requestId,
  };
}

export function caller(request: HttpRequest): AuthContext {
  if (!request.auth) throw new UnauthorizedException();
  return request.auth;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  /**
   * A public demo's shared account (ADR-062), set per deployment with
   * DEMO_EMAIL and DEMO_PASSWORD; 404 everywhere else.
   */
  @Get('demo')
  demo(): { email: string; password: string } {
    const email = process.env.DEMO_EMAIL;
    const password = process.env.DEMO_PASSWORD;
    if (!email || !password) throw new NotFoundException();
    return { email, password };
  }

  @Post('signup')
  @HttpCode(202)
  async signup(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    // Deployments without email delivery cannot verify new accounts.
    if (process.env.SIGNUPS_CLOSED === 'true') throw new ForbiddenException();
    await this.limits.consume([
      { rule: 'signupPerIp', subject: clientIp(request) },
    ]);
    await this.auth.signup(
      parse(signupRequestSchema, body),
      requestMeta(request),
    );
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
    if (!(await this.auth.verifyEmail(token, requestMeta(request)))) {
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
    const result = await this.auth.login(input, requestMeta(request));
    // Right password, but the organization requires single sign-on (ADR-058).
    if (!result.ok && result.ssoRequired) throw new ForbiddenException();
    if (!result.ok) throw new UnauthorizedException();
    response.setHeader(
      'Set-Cookie',
      sessionCookie(result.token, SESSION_TTL_SECONDS),
    );
  }

  @Post('password-reset/request')
  @HttpCode(202)
  async requestPasswordReset(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    const { email } = parse(passwordResetRequestSchema, body);
    await this.limits.consume([
      { rule: 'resetRequestPerIp', subject: clientIp(request) },
      { rule: 'resetRequestPerAccount', subject: email },
    ]);
    await this.auth.requestPasswordReset(email, requestMeta(request));
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmPasswordReset(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    await this.limits.consume([
      { rule: 'resetConfirmPerIp', subject: clientIp(request) },
    ]);
    const { token, password } = parse(passwordResetConfirmSchema, body);
    if (
      !(await this.auth.confirmPasswordReset(
        token,
        password,
        requestMeta(request),
      ))
    ) {
      throw new BadRequestException();
    }
  }

  @Post('password')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async changePassword(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    const who = caller(request);
    await this.limits.consume([
      { rule: 'passwordChangePerAccount', subject: who.user.id },
    ]);
    const input = parse(changePasswordRequestSchema, body);
    const changed = await this.auth.changePassword(
      who,
      input.currentPassword,
      input.newPassword,
      requestMeta(request),
    );
    // A wrong current password is a validation error, not a sign-out.
    if (!changed) throw new BadRequestException();
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    await this.auth.logout(caller(request), requestMeta(request));
    response.setHeader('Set-Cookie', clearedSessionCookie());
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@Req() request: HttpRequest): SessionResponse {
    return { user: caller(request).user };
  }
}
