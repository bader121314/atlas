import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { header } from '../auth/http';
import type { HttpRequest } from '../auth/http';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { ScimError } from './scim.errors';
import type { ScimTenant } from './scim.service';
import { ScimTokensService } from './scim-tokens.service';

export type ScimRequest = HttpRequest & { scim?: ScimTenant };

/** Bearer SCIM tokens only; sessions and API tokens never reach SCIM. */
@Injectable()
export class ScimGuard implements CanActivate {
  constructor(
    @Inject(ScimTokensService) private readonly tokens: ScimTokensService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ScimRequest>();
    const value = header(request, 'authorization') ?? '';
    const secret = /^Bearer\s+(\S+)$/i.exec(value)?.[1];
    if (!secret) throw new ScimError(401, 'A valid SCIM token is required.');
    await this.limits.consume([{ rule: 'scimPerToken', subject: secret }]);
    const tenant = await this.tokens.resolve(secret);
    if (!tenant) throw new ScimError(401, 'A valid SCIM token is required.');
    request.scim = tenant;
    return true;
  }
}

export function scimTenantOf(request: ScimRequest): ScimTenant {
  if (!request.scim) throw new Error('ScimGuard did not run');
  return request.scim;
}
