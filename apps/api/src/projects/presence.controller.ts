import {
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Presence } from '@atlas/contracts';
import { caller } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { PresenceService } from './presence.service';
import { ProjectGuard, RequireProjectPermission } from './project.guard';
import { projectOf, tenantOf } from './projects.controller';
import { taskNumber } from './tasks.controller';

@Controller('organizations/:slug/projects/:key/tasks/:number/presence')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class PresenceController {
  constructor(
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}

  @Put()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  heartbeat(
    @Param('number') number: string,
    @Req() request: HttpRequest,
  ): Promise<Presence> {
    return this.presence.heartbeat(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      caller(request).user.id,
    );
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  leave(
    @Param('number') number: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.presence.leave(
      tenantOf(request),
      projectOf(request),
      taskNumber(number),
      caller(request).user.id,
    );
  }
}
