import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  parseRequest,
  resourceIdSchema,
  updateMemberRequestSchema,
} from '@atlas/contracts';
import type {
  Invitation,
  InvitationListResponse,
  Organization,
} from '@atlas/contracts';
import { caller, parse, requestMeta } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest, TenantContext } from '../auth/http';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { MembershipsService } from './memberships.service';
import { RequirePermission, TenantGuard } from './tenant.guard';

function tenantOf(request: HttpRequest): TenantContext {
  if (!request.tenant) throw new Error('TenantGuard did not run');
  return request.tenant;
}

/** Path ids are validated; malformed ids answer like missing ones (404). */
function idParam(value: string): string {
  const id = parseRequest(resourceIdSchema, value);
  if (!id) throw new NotFoundException();
  return id;
}

@Controller('organizations/:slug')
@UseGuards(SessionGuard, TenantGuard)
export class MembersController {
  constructor(
    @Inject(MembershipsService)
    private readonly memberships: MembershipsService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Post('invitations')
  @RequirePermission('members.invite')
  async invite(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Invitation> {
    const input = parse(createInvitationRequestSchema, body);
    const actor = caller(request);
    await this.limits.consume([
      { rule: 'invitePerAccount', subject: actor.user.id },
    ]);
    return this.memberships.invite(
      tenantOf(request),
      actor,
      input,
      requestMeta(request),
    );
  }

  @Get('invitations')
  @RequirePermission('members.invite')
  invitations(@Req() request: HttpRequest): Promise<InvitationListResponse> {
    return this.memberships.listInvitations(tenantOf(request));
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermission('members.invite')
  revokeInvitation(
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.memberships.revokeInvitation(
      tenantOf(request),
      caller(request),
      idParam(id),
      requestMeta(request),
    );
  }

  @Patch('members/:userId')
  @RequirePermission('members.manage')
  async changeRole(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<{ role: string }> {
    const { role } = parse(updateMemberRequestSchema, body);
    await this.memberships.changeRole(
      tenantOf(request),
      caller(request),
      idParam(userId),
      role,
      requestMeta(request),
    );
    return { role };
  }

  // Any member may reach this route to leave; removing someone else is
  // checked against the role rules in MembershipsService.
  @Delete('members/:userId')
  @HttpCode(204)
  @RequirePermission('organization.read')
  remove(
    @Param('userId') userId: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.memberships.remove(
      tenantOf(request),
      caller(request),
      idParam(userId),
      requestMeta(request),
    );
  }
}

/** Accepting is not tenant-scoped: the token identifies the organization. */
@Controller('invitations')
@UseGuards(SessionGuard)
export class InvitationsController {
  constructor(
    @Inject(MembershipsService)
    private readonly memberships: MembershipsService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Post('accept')
  async accept(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<Organization> {
    await this.limits.consume([
      { rule: 'acceptInvitePerIp', subject: request.ip ?? 'unknown' },
    ]);
    const { token } = parse(acceptInvitationRequestSchema, body);
    return this.memberships.accept(
      caller(request),
      token,
      requestMeta(request),
    );
  }
}
