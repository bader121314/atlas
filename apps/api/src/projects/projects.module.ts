import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ProjectGuard } from './project.guard';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, OrganizationsModule],
  controllers: [ProjectsController, TasksController],
  providers: [ProjectsService, ProjectGuard, TasksService],
  exports: [ProjectsService, ProjectGuard],
})
export class ProjectsModule {}
