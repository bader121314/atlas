import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Presence } from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';
import { RedisService } from '../redis.service';

/** A viewer drops off this long after their last heartbeat. */
export const PRESENCE_TTL_MS = 45_000;

/**
 * Who is looking at a task right now (ADR-030). Ephemeral by design: a
 * sorted set per task in Redis, scored by expiry time, never stored in
 * PostgreSQL.
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /** Records the caller as present and returns everyone present. */
  async heartbeat(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    userId: string,
  ): Promise<Presence> {
    const key = await this.key(tenant, project, number);
    const now = Date.now();
    const ids = await this.run(async (client) => {
      const replies = await client
        .multi()
        .zAdd(key, { score: now + PRESENCE_TTL_MS, value: userId })
        .zRemRangeByScore(key, '-inf', now)
        .pExpire(key, PRESENCE_TTL_MS)
        .zRange(key, 0, -1)
        .exec();
      return (replies.at(-1) as unknown as string[] | undefined) ?? [];
    });
    const users = await this.database.pool.query<{
      id: string;
      display_name: string;
    }>(
      `SELECT u.id, u.display_name FROM users u
       JOIN organization_memberships m
         ON m.user_id = u.id AND m.organization_id = $2 AND m.state = 'active'
       WHERE u.id = ANY($1::uuid[]) ORDER BY u.display_name, u.id`,
      [ids, tenant.organizationId],
    );
    return {
      viewers: users.rows.map((u) => ({
        userId: u.id,
        displayName: u.display_name,
      })),
    };
  }

  async leave(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
    userId: string,
  ): Promise<void> {
    const key = await this.key(tenant, project, number);
    await this.run((client) => client.zRem(key, userId));
  }

  private async key(
    tenant: TenantContext,
    project: ProjectContext,
    number: number,
  ): Promise<string> {
    const task = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM tasks
       WHERE organization_id = $1 AND project_id = $2 AND number = $3`,
      [tenant.organizationId, project.id, number],
    );
    const id = task.rows[0]?.id;
    if (!id) throw new NotFoundException();
    return `atlas:presence:${tenant.organizationId}:${id}`;
  }

  private async run<T>(
    action: (client: Awaited<ReturnType<RedisService['client']>>) => Promise<T>,
  ): Promise<T> {
    try {
      return await action(await this.redis.client());
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
