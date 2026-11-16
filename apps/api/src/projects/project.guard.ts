import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { parseRequest, projectKeySchema } from '@atlas/contracts';
import type { HttpRequest } from '../auth/http';
import { canProject } from './policy';
import type { ProjectAction } from './policy';
import { ProjectsService } from './projects.service';

const PROJECT_PERMISSION = 'atlas:project-permission';

export const RequireProjectPermission = (action: ProjectAction) =>
  SetMetadata(PROJECT_PERMISSION, action);

/**
 * Runs after SessionGuard and TenantGuard. Resolves `:key` inside the
 * caller's organization. No access answers 404 like a missing project; a
 * visible project without the needed permission answers 403.
 */
@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<ProjectAction | undefined>(
      PROJECT_PERMISSION,
      context.getHandler(),
    );
    if (!action) throw new ForbiddenException();
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (!request.auth || !request.tenant) throw new ForbiddenException();
    const key = parseRequest(projectKeySchema, request.params?.key);
    const project = key
      ? await this.projects.resolve(request.tenant, request.auth.user.id, key)
      : undefined;
    if (!project) throw new NotFoundException();
    if (!canProject(project.role, action)) throw new ForbiddenException();
    request.project = project;
    return true;
  }
}
