import {
  Controller,
  Get,
  Inject,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { resourceIdSchema, parseRequest } from '@atlas/contracts';
import type { ProjectEvent } from '@atlas/contracts';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { SessionGuard } from '../auth/guards';
import { header, readCookie } from '../auth/http';
import type { HttpRequest } from '../auth/http';
import { OrganizationsService } from '../organizations/organizations.service';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { canProject } from '../projects/policy';
import {
  ProjectGuard,
  RequireProjectPermission,
} from '../projects/project.guard';
import { projectOf, tenantOf } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';
import { EventBus } from './event-bus.service';
import { EventsService } from './events.service';

/**
 * Timing for event streams. The environment overrides exist so tests can
 * shorten the intervals; production uses the defaults.
 */
export class EventStreamSettings {
  heartbeatMs = Number(process.env.EVENT_STREAM_HEARTBEAT_MS ?? 25_000);
  revalidateMs = Number(process.env.EVENT_STREAM_REVALIDATE_MS ?? 30_000);
}

/** The parts of the Node response an event stream needs. */
interface StreamResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string): boolean;
  end(): void;
  on(event: 'close', listener: () => void): void;
  flushHeaders?(): void;
}

function frame(event: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Server-Sent Events for one project (ADR-029). Access is checked by the
 * usual guards when the stream opens and again on a timer; when it is lost
 * the stream says so and closes.
 */
@Controller('organizations/:slug/projects/:key/events')
@UseGuards(SessionGuard, TenantGuard, ProjectGuard)
export class EventsController {
  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OrganizationsService)
    private readonly organizations: OrganizationsService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(EventStreamSettings) private readonly settings: EventStreamSettings,
  ) {}

  @Get()
  @RequirePermission('organization.read')
  @RequireProjectPermission('task.read')
  async stream(
    @Req() request: HttpRequest,
    @Res() response: StreamResponse,
  ): Promise<void> {
    const tenant = tenantOf(request);
    const project = projectOf(request);
    const userId = request.auth?.user.id ?? '';
    const sent = new Set<string>();
    const buffered: ProjectEvent[] = [];
    let replaying = true;
    let open = true;

    const send = (event: ProjectEvent) => {
      if (!open || sent.has(event.id)) return;
      sent.add(event.id);
      response.write(frame('task', event, event.id));
    };
    const unsubscribe = await this.bus
      .subscribe(tenant.organizationId, project.id, (event) =>
        replaying ? buffered.push(event) : send(event),
      )
      .catch(() => {
        throw new ServiceUnavailableException();
      });

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write('retry: 3000\n\n');
    response.flushHeaders?.();

    const close = () => {
      if (!open) return;
      open = false;
      clearInterval(heartbeat);
      clearInterval(revalidate);
      unsubscribe();
    };
    const heartbeat = setInterval(() => {
      if (open) response.write(': ping\n\n');
    }, this.settings.heartbeatMs);
    const revalidate = setInterval(() => {
      void this.stillAllowed(request, userId).then((allowed) => {
        if (allowed || !open) return;
        response.write(frame('revoked', {}));
        close();
        response.end();
      });
    }, this.settings.revalidateMs);
    response.on('close', close);

    const lastEventId = parseRequest(
      resourceIdSchema,
      header(request, 'last-event-id'),
    );
    if (lastEventId) {
      const replay = await this.events.replay(tenant, project, lastEventId);
      if (replay.events) replay.events.forEach(send);
      else response.write(frame('resync', {}));
    }
    replaying = false;
    buffered.forEach(send);
    buffered.length = 0;
    if (open) response.write(frame('ready', {}));
  }

  /** Session, membership and project access, checked as the guards do. */
  private async stillAllowed(
    request: HttpRequest,
    userId: string,
  ): Promise<boolean> {
    try {
      const token = readCookie(request, sessionCookieName());
      const session = token ? await this.auth.authenticate(token) : undefined;
      if (!session || session.user.id !== userId) return false;
      const slug = request.params?.slug ?? '';
      const tenant = await this.organizations.resolveMembership(slug, userId);
      if (!tenant) return false;
      const project = await this.projects.resolve(
        tenant,
        userId,
        request.params?.key ?? '',
      );
      return !!project && canProject(project.role, 'task.read');
    } catch {
      // A database hiccup is not a revocation; check again next time.
      return true;
    }
  }
}
