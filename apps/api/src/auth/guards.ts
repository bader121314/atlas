import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service';
import { sessionCookieName } from './cookies';
import { header, readCookie } from './http';
import type { HttpRequest } from './http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense for cookie-authenticated writes: every state-changing request
 * must carry an Origin header exactly equal to the configured web origin.
 * Combined with SameSite=Lax cookies. Registered globally.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
    if (header(request, 'origin') !== this.auth.config.WEB_ORIGIN) {
      throw new ForbiddenException();
    }
    return true;
  }
}

/** Requires a live session cookie and attaches the caller to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const token = readCookie(request, sessionCookieName());
    const session = token ? await this.auth.authenticate(token) : undefined;
    if (!session) throw new UnauthorizedException();
    request.auth = session;
    return true;
  }
}
