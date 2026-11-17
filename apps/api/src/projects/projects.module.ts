import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { EventBus } from '../events/event-bus.service';
import {
  EventStreamSettings,
  EventsController,
} from '../events/events.controller';
import { EventsService } from '../events/events.service';
import { NotificationsController } from '../notifications/notifications.controller';
import { NotificationsService } from '../notifications/notifications.service';
import { SearchController } from '../search/search.controller';
import { SearchService } from '../search/search.service';
import { ApiTokensController } from '../tokens/api-tokens.controller';
import { ApiTokensService } from '../tokens/api-tokens.service';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { TaskTimeController, TimeReportController } from './time.controller';
import { TimeService } from './time.service';
import {
  PublicSharesController,
  ShareLinksController,
} from '../shares/shares.controller';
import { SharesService } from '../shares/shares.service';
import { AuditLogController } from '../audit/audit-log.controller';
import { AuditLogService } from '../audit/audit-log.service';
import { UsageController } from '../usage/usage.controller';
import { PushController } from '../push/push.controller';
import { WorkloadController } from '../workload/workload.controller';
import { WorkloadService } from '../workload/workload.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ActivityService } from './activity.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AttachmentsController } from './attachments.controller';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AttachmentsService, StorageProvider } from './attachments.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';
import { LabelsController, TaskLabelsController } from './labels.controller';
import { LabelsService } from './labels.service';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
import { ProjectGuard } from './project.guard';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RecurrencesController } from './recurrences.controller';
import { RecurrencesService } from './recurrences.service';
import { StatesController } from './states.controller';
import { StatesService } from './states.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { ViewsController } from './views.controller';
import { ViewsService } from './views.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    RateLimitModule,
  ],
  controllers: [
    ProjectsController,
    TasksController,
    CommentsController,
    LabelsController,
    TaskLabelsController,
    StatesController,
    PlanningController,
    ViewsController,
    FieldsController,
    EventsController,
    PresenceController,
    NotificationsController,
    SearchController,
    AnalyticsController,
    AttachmentsController,
    ExportsController,
    WebhooksController,
    ApiTokensController,
    AutomationsController,
    RecurrencesController,
    WorkloadController,
    TaskTimeController,
    TimeReportController,
    ShareLinksController,
    PublicSharesController,
    AuditLogController,
    UsageController,
    PushController,
  ],
  providers: [
    ProjectsService,
    ProjectGuard,
    TasksService,
    ActivityService,
    CommentsService,
    LabelsService,
    StatesService,
    PlanningService,
    ViewsService,
    FieldsService,
    EventBus,
    EventsService,
    EventStreamSettings,
    PresenceService,
    NotificationsService,
    SearchService,
    AnalyticsService,
    AttachmentsService,
    StorageProvider,
    ExportsService,
    WebhooksService,
    ApiTokensService,
    AutomationsService,
    RecurrencesService,
    WorkloadService,
    TimeService,
    SharesService,
    AuditLogService,
  ],
  exports: [ProjectsService, ProjectGuard],
})
export class ProjectsModule {}
