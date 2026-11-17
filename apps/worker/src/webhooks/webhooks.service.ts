import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { parseEnvironment } from '@atlas/config';
import { webhookSettings } from '@atlas/shared';
import { planBatch } from './planner';
import { deliverBatch } from './sender';
import { tracked } from '../metrics';

const TICK_MS = 1000;

/** Plans and sends webhooks in the worker (ADR-036). */
@Injectable()
export class WebhooksService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Webhooks');
  private pool: Pool | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly busy = new Set<string>();

  onApplicationBootstrap(): void {
    const settings = webhookSettings(process.env);
    const pool = new Pool({
      connectionString: parseEnvironment(process.env).DATABASE_URL,
      max: 2,
    });
    this.pool = pool;
    const guarded = (name: string, run: () => Promise<unknown>) => async () => {
      if (this.busy.has(name)) return;
      this.busy.add(name);
      try {
        await tracked(`webhook_${name}`, run);
      } catch {
        this.logger.error(`webhook ${name} failed; retrying`);
      } finally {
        this.busy.delete(name);
      }
    };
    this.timers.push(
      setInterval(
        guarded('plan', () => planBatch(pool)),
        TICK_MS,
      ),
    );
    if (settings) {
      this.timers.push(
        setInterval(
          guarded('send', () =>
            deliverBatch(pool, {
              material: settings.material,
              allowedHosts: settings.allowedHosts,
            }),
          ),
          TICK_MS,
        ),
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.timers.forEach(clearInterval);
    await this.pool?.end();
  }
}
