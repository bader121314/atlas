import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TaskExport } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { StorageProvider } from './attachments.service';

/** At most this many exports waiting per person and project. */
const MAX_QUEUED = 3;

interface Row {
  id: string;
  status: TaskExport['status'];
  row_count: number | null;
  created_at: Date;
  expires_at: Date | null;
  storage_key: string | null;
}

function toExport(row: Row): TaskExport {
  return {
    id: row.id,
    status: row.status,
    rowCount: row.row_count,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
  };
}

/**
 * CSV exports of a project's tasks (ADR-035). The worker builds them; only
 * the person who asked can download, while they still have access, until
 * the export expires.
 */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(StorageProvider) private readonly storage: StorageProvider,
  ) {}

  async request(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
  ): Promise<TaskExport> {
    if (!this.storage.store()) throw new ServiceUnavailableException();
    const queued = await this.database.pool.query<{ count: string }>(
      `SELECT count(*) FROM exports WHERE organization_id = $1 AND project_id = $2
         AND requested_by_user_id = $3 AND status = 'queued'`,
      [tenant.organizationId, project.id, userId],
    );
    if (Number(queued.rows[0]?.count) >= MAX_QUEUED)
      throw new ConflictException();
    const result = await this.database.pool.query<Row>(
      `INSERT INTO exports (organization_id, project_id, requested_by_user_id)
       VALUES ($1, $2, $3)
       RETURNING id, status, row_count, created_at, expires_at, storage_key`,
      [tenant.organizationId, project.id, userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('export insert returned no row');
    return toExport(row);
  }

  async list(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
  ): Promise<TaskExport[]> {
    const result = await this.database.pool.query<Row>(
      `SELECT id, status, row_count, created_at, expires_at, storage_key
       FROM exports WHERE organization_id = $1 AND project_id = $2
         AND requested_by_user_id = $3
       ORDER BY created_at DESC LIMIT 10`,
      [tenant.organizationId, project.id, userId],
    );
    return result.rows.map(toExport);
  }

  async downloadUrl(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    id: string,
    projectKey: string,
  ): Promise<string> {
    const store = this.storage.store();
    if (!store) throw new ServiceUnavailableException();
    const result = await this.database.pool.query<Row & { expired: boolean }>(
      `SELECT id, status, row_count, created_at, expires_at, storage_key,
              expires_at <= now() AS expired
       FROM exports WHERE organization_id = $1 AND project_id = $2
         AND requested_by_user_id = $3 AND id = $4`,
      [tenant.organizationId, project.id, userId, id],
    );
    const row = result.rows[0];
    // Someone else's export looks like no export at all.
    if (!row) throw new NotFoundException();
    if (row.status === 'expired' || row.expired) throw new GoneException();
    if (row.status !== 'ready' || !row.storage_key)
      throw new ConflictException();
    const day = row.created_at.toISOString().slice(0, 10);
    return store.downloadUrl(
      row.storage_key,
      `${projectKey}-tasks-${day}.csv`,
      'text/csv',
    );
  }
}
