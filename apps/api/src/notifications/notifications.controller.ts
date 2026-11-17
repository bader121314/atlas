import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  markNotificationsReadRequestSchema,
  notificationQuerySchema,
  updateNotificationSettingsSchema,
} from '@atlas/contracts';
import type { Notification, NotificationSettings } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { tenantOf } from '../projects/projects.controller';
import { NotificationsService } from './notifications.service';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';

@Controller('organizations/:slug')
@UseGuards(SessionGuard, TenantGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  @Get('notifications')
  @RequirePermission('organization.read')
  list(
    @Query() query: unknown,
    @Req() request: HttpRequest,
  ): Promise<Notification[]> {
    const { unread } = parse(notificationQuerySchema, query);
    return this.notifications.list(
      tenantOf(request),
      caller(request).user.id,
      unread === 'true',
    );
  }

  @Get('notifications/unread-count')
  @RequirePermission('organization.read')
  async unreadCount(@Req() request: HttpRequest): Promise<{ count: number }> {
    return {
      count: await this.notifications.unreadCount(
        tenantOf(request),
        caller(request).user.id,
      ),
    };
  }

  @Post('notifications/read')
  @HttpCode(204)
  @RequirePermission('organization.read')
  markRead(@Body() body: unknown, @Req() request: HttpRequest): Promise<void> {
    const input = parse(markNotificationsReadRequestSchema, body);
    return this.notifications.markRead(
      tenantOf(request),
      caller(request).user.id,
      'all' in input ? 'all' : input.ids,
    );
  }

  @Get('notification-settings')
  @RequirePermission('organization.read')
  settings(@Req() request: HttpRequest): Promise<NotificationSettings> {
    return this.notifications.settings(
      tenantOf(request),
      caller(request).user.id,
    );
  }

  @Put('notification-settings')
  @RequirePermission('organization.read')
  updateSettings(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<NotificationSettings> {
    return this.notifications.updateSettings(
      tenantOf(request),
      caller(request).user.id,
      parse(updateNotificationSettingsSchema, body),
    );
  }
}
