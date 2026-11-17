import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import { viewConfigSchema } from '@atlas/contracts';
import type { SavedView, ViewConfig } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

const MAX_VIEWS_PER_USER = 50;

/**
 * Saved views (ADR-025): named filters and layouts. Private views are seen
 * only by their owner; shared views by everyone who can read the project.
 */
@Injectable()
export class ViewsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
  ): Promise<SavedView[]> {
    const result = await this.database.pool.query<{
      id: string;
      name: string;
      shared: boolean;
      owner_user_id: string;
      owner_name: string;
      config: unknown;
    }>(
      `SELECT v.id, v.name, v.shared, v.owner_user_id, u.display_name AS owner_name, v.config
       FROM saved_views v JOIN users u ON u.id = v.owner_user_id
       WHERE v.organization_id = $1 AND v.project_id = $2
         AND (v.owner_user_id = $3 OR v.shared)
       ORDER BY lower(v.name)
       LIMIT 200`,
      [tenant.organizationId, project.id, userId],
    );
    const views: SavedView[] = [];
    for (const row of result.rows) {
      // Stored configs are re-validated on the way out; anything that no
      // longer matches the schema is skipped rather than sent to clients.
      const config = viewConfigSchema.safeParse(row.config);
      if (!config.success) continue;
      views.push({
        id: row.id,
        name: row.name,
        shared: row.shared,
        mine: row.owner_user_id === userId,
        owner: row.owner_name,
        config: config.data,
      });
    }
    return views;
  }

  async create(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    input: { name: string; shared: boolean; config: ViewConfig },
  ): Promise<SavedView> {
    return this.database.transaction(async (client) => {
      const count = await client.query<{ count: string }>(
        `SELECT count(*) FROM saved_views
         WHERE organization_id = $1 AND project_id = $2 AND owner_user_id = $3`,
        [tenant.organizationId, project.id, userId],
      );
      if (Number(count.rows[0]?.count) >= MAX_VIEWS_PER_USER)
        throw new ConflictException();
      try {
        const result = await client.query<{ id: string; owner_name: string }>(
          `INSERT INTO saved_views (organization_id, project_id, owner_user_id, name, shared, config)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, (SELECT display_name FROM users WHERE id = $3) AS owner_name`,
          [
            tenant.organizationId,
            project.id,
            userId,
            input.name,
            input.shared,
            JSON.stringify(input.config),
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('view insert returned no row');
        return {
          id: row.id,
          name: input.name,
          shared: input.shared,
          mine: true,
          owner: row.owner_name,
          config: input.config,
        };
      } catch (error) {
        if (error instanceof DatabaseError && error.code === '23505') {
          throw new ConflictException();
        }
        throw error;
      }
    });
  }

  /** Owners delete their views; project managers may also remove shared ones. */
  async remove(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    id: string,
  ): Promise<void> {
    const found = await this.database.pool.query<{
      owner_user_id: string;
      shared: boolean;
    }>(
      `SELECT owner_user_id, shared FROM saved_views
       WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [tenant.organizationId, project.id, id],
    );
    const view = found.rows[0];
    if (!view || (view.owner_user_id !== userId && !view.shared))
      throw new NotFoundException();
    if (view.owner_user_id !== userId && project.role !== 'manager')
      throw new ForbiddenException();
    await this.database.pool.query(
      'DELETE FROM saved_views WHERE organization_id = $1 AND project_id = $2 AND id = $3',
      [tenant.organizationId, project.id, id],
    );
  }
}
