import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ActivityService } from './activity.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { LabelsController, TaskLabelsController } from './labels.controller';
import { LabelsService } from './labels.service';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { ProjectGuard } from './project.guard';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { StatesController } from './states.controller';
import { StatesService } from './states.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, OrganizationsModule],
  controllers: [
    ProjectsController,
    TasksController,
    CommentsController,
    LabelsController,
    TaskLabelsController,
    StatesController,
    PlanningController,
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
  ],
  exports: [ProjectsService, ProjectGuard],
})
export class ProjectsModule {}
