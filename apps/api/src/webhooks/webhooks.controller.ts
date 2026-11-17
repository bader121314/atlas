import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createWebhookRequestSchema,
  updateWebhookRequestSchema,
} from '@atlas/contracts';
import type { WebhookDelivery, WebhookEndpoint } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { idParam, tenantOf } from '../projects/projects.controller';
import { WebhooksService } from './webhooks.service';

@Controller('organizations/:slug/webhooks')
@UseGuards(SessionGuard, TenantGuard)
export class WebhooksController {
  constructor(
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
  ) {}

  @Get()
  @RequirePermission('webhooks.manage')
  list(@Req() request: HttpRequest): Promise<WebhookEndpoint[]> {
    return this.webhooks.list(tenantOf(request));
  }

  @Post()
  @RequirePermission('webhooks.manage')
  create(@Body() body: unknown, @Req() request: HttpRequest) {
    return this.webhooks.create(
      tenantOf(request),
      caller(request).user.id,
      parse(createWebhookRequestSchema, body),
    );
  }

  @Patch(':id')
  @RequirePermission('webhooks.manage')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<WebhookEndpoint> {
    return this.webhooks.update(
      tenantOf(request),
      idParam(id),
      parse(updateWebhookRequestSchema, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('webhooks.manage')
  remove(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.webhooks.remove(tenantOf(request), idParam(id));
  }

  @Get(':id/deliveries')
  @RequirePermission('webhooks.manage')
  deliveries(
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<WebhookDelivery[]> {
    return this.webhooks.deliveries(tenantOf(request), idParam(id));
  }

  @Post(':id/deliveries/:deliveryId/replay')
  @HttpCode(202)
  @RequirePermission('webhooks.manage')
  replay(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    return this.webhooks.replay(
      tenantOf(request),
      idParam(id),
      idParam(deliveryId),
    );
  }

  @Post(':id/ping')
  @HttpCode(202)
  @RequirePermission('webhooks.manage')
  ping(@Param('id') id: string, @Req() request: HttpRequest): Promise<void> {
    return this.webhooks.ping(tenantOf(request), idParam(id));
  }
}
