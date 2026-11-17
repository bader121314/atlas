import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { Label } from '@atlas/contracts';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

/** Organization-wide labels, shared by every project in the organization. */
@Injectable()
export class LabelsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(tenant: TenantContext): Promise<Label[]> {
    const result = await this.database.pool.query<Label>(
      `SELECT id, name, color FROM labels
       WHERE organization_id = $1 ORDER BY lower(name) LIMIT 500`,
      [tenant.organizationId],
    );
    return result.rows;
  }

  async create(
    tenant: TenantContext,
    name: string,
    color: Label['color'],
  ): Promise<Label> {
    try {
      const result = await this.database.pool.query<Label>(
        `INSERT INTO labels (organization_id, name, color) VALUES ($1, $2, $3)
         RETURNING id, name, color`,
        [tenant.organizationId, name, color],
      );
      const row = result.rows[0];
      if (!row) throw new Error('label insert returned no row');
      return row;
    } catch (error) {
      if (
        error instanceof DatabaseError &&
        error.constraint === 'labels_organization_id_name_key'
      ) {
        throw new ConflictException();
      }
      throw error;
    }
  }

  /** Deleting a label also removes it from every task (cascade). */
  async remove(tenant: TenantContext, id: string): Promise<void> {
    const result = await this.database.pool.query(
      'DELETE FROM labels WHERE organization_id = $1 AND id = $2',
      [tenant.organizationId, id],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
  }
}
