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
import { ActivityService } from './activity.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
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
  ],
  exports: [ProjectsService, ProjectGuard],
})
export class ProjectsModule {}
