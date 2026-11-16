import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { organizationSlugSchema, parseRequest } from '@atlas/contracts';
import type { HttpRequest } from '../auth/http';
import { OrganizationsService } from './organizations.service';
import { can } from './policy';
import type { OrganizationAction } from './policy';

const PERMISSION = 'atlas:organization-permission';

/** Declares the policy action a tenant route performs. Required. */
export const RequirePermission = (action: OrganizationAction) =>
  SetMetadata(PERMISSION, action);

/**
 * Resolves `:slug` to the caller's active membership. Non-members and unknown
 * slugs get the same 404, so organizations cannot be discovered; members
 * without the route's permission get 403. Must run after SessionGuard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(OrganizationsService)
    private readonly organizations: OrganizationsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<OrganizationAction | undefined>(
      PERMISSION,
      context.getHandler(),
    );
    // Fail closed: a tenant route without a declared permission is a bug.
    if (!action) throw new ForbiddenException();
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (!request.auth) throw new UnauthorizedException();
    const slug = parseRequest(organizationSlugSchema, request.params?.slug);
    const tenant = slug
      ? await this.organizations.resolveMembership(slug, request.auth.user.id)
      : undefined;
    if (!tenant) throw new NotFoundException();
    if (!can(tenant.role, action)) throw new ForbiddenException();
    request.tenant = tenant;
    return true;
  }
}
