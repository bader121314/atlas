import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { PoolClient } from 'pg';
import type { CreateFieldRequest, CustomField } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { ActivityService } from './activity.service';

const MAX_FIELDS = 20;

interface Typed {
  text: string | null;
  number: number | null;
  date: string | null;
}

/** Checks a value against the field's type; `undefined` means invalid. */
export function coerceFieldValue(
  field: Pick<CustomField, 'type' | 'options'>,
  value: string | number,
): Typed | undefined {
  switch (field.type) {
    case 'number':
      return typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) < 1e15
        ? { text: null, number: value, date: null }
        : undefined;
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return undefined;
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().startsWith(value)
        ? { text: null, number: null, date: value }
        : undefined;
    }
    case 'select':
      return typeof value === 'string' && field.options.includes(value)
        ? { text: value, number: null, date: null }
        : undefined;
    default: {
      if (typeof value !== 'string') return undefined;
      const text = value.trim();
      return text.length > 0 && text.length <= 500
        ? { text, number: null, date: null }
        : undefined;
    }
  }
}

/** Project custom fields and their task values (ADR-026). */
@Injectable()
export class FieldsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  async list(
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<CustomField[]> {
    const result = await this.database.pool.query<CustomField>(
      `SELECT id, name, type, options, position FROM custom_fields
       WHERE organization_id = $1 AND project_id = $2 ORDER BY position`,
      [tenant.organizationId, project.id],
    );
    return result.rows;
  }

  async create(
    tenant: TenantContext,
    project: ProjectContext,
    input: CreateFieldRequest,
  ): Promise<CustomField> {
    return this.database.transaction(async (client) => {
      const existing = await client.query<{
        count: string;
        max: number | null;
      }>(
        `SELECT count(*), max(position) FROM custom_fields
         WHERE organization_id = $1 AND project_id = $2`,
        [tenant.organizationId, project.id],
      );
      const stats = existing.rows[0];
      if (Number(stats?.count) >= MAX_FIELDS) throw new ConflictException();
      const options = input.type === 'select' ? input.options : [];
      try {
        const result = await client.query<CustomField>(
          `INSERT INTO custom_fields (organization_id, project_id, name, type, options, position)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, name, type, options, position`,
          [
            tenant.organizationId,
            project.id,
            input.name,
            input.type,
            JSON.stringify(options),
            (stats?.max ?? 0) + 1,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('field insert returned no row');
        return row;
      } catch (error) {
        if (error instanceof DatabaseError && error.code === '23505')
          throw new ConflictException();
        throw error;
      }
    });
  }

  /**
   * Renames a field or replaces a select field's options. Values that use a
   * removed option are cleared in the same transaction. The type never changes.
   */
  async update(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
    input: { name?: string | undefined; options?: string[] | undefined },
  ): Promise<CustomField> {
    return this.database.transaction(async (client) => {
      const field = await this.field(client, tenant, project, id);
      if (input.options && field.type !== 'select')
        throw new BadRequestException();
      try {
        const result = await client.query<CustomField>(
          `UPDATE custom_fields SET name = COALESCE($4, name), options = COALESCE($5, options)
           WHERE organization_id = $1 AND project_id = $2 AND id = $3
           RETURNING id, name, type, options, position`,
          [
            tenant.organizationId,
            project.id,
            id,
            input.name ?? null,
            input.options ? JSON.stringify(input.options) : null,
          ],
        );
        if (input.options) {
          await client.query(
            `DELETE FROM task_field_values
             WHERE organization_id = $1 AND field_id = $2
               AND NOT (value_text = ANY($3::text[]))`,
            [tenant.organizationId, id, input.options],
          );
        }
        const row = result.rows[0];
        if (!row) throw new NotFoundException();
        return row;
      } catch (error) {
        if (error instanceof DatabaseError && error.code === '23505')
          throw new ConflictException();
        throw error;
      }
    });
  }

  async remove(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ): Promise<void> {
    const result = await this.database.pool.query(
      'DELETE FROM custom_fields WHERE organization_id = $1 AND project_id = $2 AND id = $3',
      [tenant.organizationId, project.id, id],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
  }

  /** Sets or clears (null) a task's value, bumping the task version. */
  async setValue(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    fieldId: string,
    userId: string,
    value: string | number | null,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const active = await client.query(
        `SELECT 1 FROM projects WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
        [tenant.organizationId, project.id],
      );
      if (!active.rowCount) throw new ConflictException();
      const task = await client.query<{ id: string; version: string }>(
        `UPDATE tasks SET version = version + 1, updated_at = now()
         WHERE organization_id = $1 AND project_id = $2 AND number = $3
         RETURNING id, version`,
        [tenant.organizationId, project.id, number],
      );
      const row = task.rows[0];
      if (!row) throw new NotFoundException();
      const field = await this.field(client, tenant, project, fieldId);
      if (value === null) {
        await client.query(
          'DELETE FROM task_field_values WHERE task_id = $1 AND field_id = $2',
          [row.id, fieldId],
        );
      } else {
        const typed = coerceFieldValue(field, value);
        if (!typed) throw new BadRequestException();
        await client.query(
          `INSERT INTO task_field_values (organization_id, project_id, task_id, field_id,
             value_text, value_number, value_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (task_id, field_id) DO UPDATE SET
             value_text = EXCLUDED.value_text,
             value_number = EXCLUDED.value_number,
             value_date = EXCLUDED.value_date`,
          [
            tenant.organizationId,
            project.id,
            row.id,
            fieldId,
            typed.text,
            typed.number,
            typed.date,
          ],
        );
      }
      await this.activity.record(client, {
        organizationId: tenant.organizationId,
        projectId: project.id,
        taskId: row.id,
        actorUserId: userId,
        action: 'task.updated',
        changes: { customField: field.name },
        aggregateVersion: Number(row.version),
      });
    });
  }

  private async field(
    client: PoolClient,
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ): Promise<CustomField> {
    const result = await client.query<CustomField>(
      `SELECT id, name, type, options, position FROM custom_fields
       WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [tenant.organizationId, project.id, id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }
}
