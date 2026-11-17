import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { auditExportQuerySchema, auditQuerySchema } from '@atlas/contracts';
import type { AuditPage } from '@atlas/contracts';
import { caller, parse, requestMeta } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest, HttpResponse } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { tenantOf } from '../projects/projects.controller';
import { AuditLogService } from './audit-log.service';
import { AuditService } from './audit.service';

@Controller('organizations/:slug/audit-events')
@UseGuards(SessionGuard, TenantGuard)
export class AuditLogController {
  constructor(
    @Inject(AuditLogService) private readonly log: AuditLogService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('audit.read')
  list(
    @Query() query: unknown,
    @Req() request: HttpRequest,
  ): Promise<AuditPage> {
    return this.log.page(tenantOf(request), parse(auditQuerySchema, query));
  }

  /** Download as CSV. The download itself is audited. */
  @Get('export')
  @RequirePermission('audit.read')
  async export(
    @Query() query: unknown,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<string> {
    const range = parse(auditExportQuerySchema, query);
    const tenant = tenantOf(request);
    const result = await this.log.exportCsv(tenant, range.from, range.to);
    await this.audit.record({
      action: 'org.audit.exported',
      actorUserId: caller(request).user.id,
      organizationId: tenant.organizationId,
      metadata: {
        from: range.from,
        to: range.to,
        rows: result.rows,
        truncated: result.truncated,
      },
      request: requestMeta(request),
    });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-${range.from}-to-${range.to}.csv"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    if (result.truncated) response.setHeader('X-Atlas-Truncated', 'true');
    return result.csv;
  }
}
