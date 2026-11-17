import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Attachment, CreateAttachmentRequest } from '@atlas/contracts';
import { ObjectStore, safeFilename, storageSettings } from '@atlas/shared';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { inScope, scopeOf } from './label-scope';

const MAX_PER_TASK = 20;

interface Row {
  id: string;
  filename: string;
  content_type: Attachment['contentType'];
  size_bytes: number;
  status: Attachment['status'];
  rejection_reason: string | null;
  uploaded_by_user_id: string;
  uploader: string;
  created_at: Date;
  storage_key: string;
}

const SELECT = `SELECT a.id, a.filename, a.content_type, a.size_bytes, a.status,
  a.rejection_reason, a.uploaded_by_user_id, u.display_name AS uploader,
  a.created_at, a.storage_key
  FROM attachments a JOIN users u ON u.id = a.uploaded_by_user_id`;

function toAttachment(row: Row): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size_bytes,
    status: row.status,
    rejectionReason: row.rejection_reason,
    uploadedBy: { userId: row.uploaded_by_user_id, displayName: row.uploader },
    createdAt: row.created_at.toISOString(),
  };
}

/** Which storage to use; tests replace it. */
export class StorageProvider {
  store(): ObjectStore | undefined {
    const settings = storageSettings(process.env);
    return settings ? new ObjectStore(settings) : undefined;
  }
}

/**
 * Task attachments (ADR-034): the browser uploads straight to object storage
 * with a presigned URL; nothing is downloadable until the worker has checked
 * the content.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(StorageProvider) private readonly storage: StorageProvider,
  ) {}

  private requireStore(): ObjectStore {
    const store = this.storage.store();
    if (!store) throw new ServiceUnavailableException();
    return store;
  }

  async list(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<Attachment[]> {
    const taskId = await this.taskId(tenant, project, number);
    const result = await this.database.pool.query<Row>(
      `${SELECT} WHERE a.organization_id = $1 AND a.task_id = $2
         AND a.status <> 'pending'
       ORDER BY a.created_at, a.id`,
      [tenant.organizationId, taskId],
    );
    return result.rows.map(toAttachment);
  }

  /** Records a pending attachment and returns where to upload it. */
  async create(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    userId: string,
    input: CreateAttachmentRequest,
  ): Promise<{
    attachment: Attachment;
    upload: { url: string; headers: Record<string, string> };
  }> {
    const store = this.requireStore();
    const taskId = await this.taskId(tenant, project, number);
    const count = await this.database.pool.query<{ count: string }>(
      `SELECT count(*) FROM attachments WHERE organization_id = $1 AND task_id = $2
         AND status <> 'rejected'`,
      [tenant.organizationId, taskId],
    );
    if (Number(count.rows[0]?.count) >= MAX_PER_TASK)
      throw new ConflictException();
    const inserted = await this.database.pool.query<{ id: string }>(
      `WITH new AS (SELECT gen_random_uuid() AS id)
       INSERT INTO attachments (id, organization_id, project_id, task_id,
         uploaded_by_user_id, filename, content_type, size_bytes, storage_key)
       SELECT new.id, $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7,
         $1::uuid::text || '/' || $2::uuid::text || '/' || $3::uuid::text
           || '/' || new.id::text
       FROM new
       RETURNING id`,
      [
        tenant.organizationId,
        project.id,
        taskId,
        userId,
        safeFilename(input.filename),
        input.contentType,
        input.size,
      ],
    );
    const row = await this.row(tenant, project, inserted.rows[0]?.id ?? '');
    return {
      attachment: toAttachment(row),
      upload: {
        url: store.uploadUrl(row.storage_key, input.contentType),
        headers: { 'content-type': input.contentType },
      },
    };
  }

  /**
   * Called after the upload: the object must exist with the declared size.
   * It then waits in quarantine for the worker's checks.
   */
  async complete(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
    userId: string,
  ): Promise<Attachment> {
    const store = this.requireStore();
    const row = await this.row(tenant, project, id);
    if (row.uploaded_by_user_id !== userId) throw new ForbiddenException();
    if (row.status !== 'pending') throw new ConflictException();
    const size = await store.size(row.storage_key);
    if (size === undefined) throw new UnprocessableEntityException();
    if (size !== row.size_bytes) {
      await store.remove(row.storage_key);
      await this.database.pool.query(
        `UPDATE attachments SET status = 'rejected', rejection_reason = 'size',
           checked_at = now() WHERE id = $1`,
        [id],
      );
      throw new UnprocessableEntityException();
    }
    await this.database.pool.query(
      `UPDATE attachments SET status = 'quarantined' WHERE id = $1 AND status = 'pending'`,
      [id],
    );
    return toAttachment(await this.row(tenant, project, id));
  }

  /** A one-minute download URL, only for checked, clean files. */
  async downloadUrl(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ): Promise<string> {
    const store = this.requireStore();
    const row = await this.row(tenant, project, id);
    if (row.status !== 'clean') throw new ConflictException();
    return store.downloadUrl(row.storage_key, row.filename, row.content_type);
  }

  /** The uploader or a project manager removes an attachment. */
  async remove(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
    userId: string,
  ): Promise<void> {
    const row = await this.row(tenant, project, id);
    if (row.uploaded_by_user_id !== userId && project.role !== 'manager')
      throw new ForbiddenException();
    await this.storage.store()?.remove(row.storage_key);
    await this.database.pool.query('DELETE FROM attachments WHERE id = $1', [
      id,
    ]);
  }

  private async taskId(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<string> {
    const task = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM tasks WHERE organization_id = $1 AND project_id = $2 AND number = $3
         AND ${inScope('tasks.id', '$4')}`,
      [tenant.organizationId, project.id, number, scopeOf(project)],
    );
    const id = task.rows[0]?.id;
    if (!id) throw new NotFoundException();
    return id;
  }

  private async row(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ): Promise<Row> {
    const result = await this.database.pool.query<Row>(
      `${SELECT} WHERE a.organization_id = $1 AND a.project_id = $2 AND a.id = $3
         AND ${inScope('a.task_id', '$4')}`,
      [tenant.organizationId, project.id, id, scopeOf(project)],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }
}
