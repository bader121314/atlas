import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { parseEnvironment } from '@atlas/config';
import { dispatchBatch, prunePublished } from './dispatcher';
import { tracked } from '../metrics';

const IDLE_MS = 500;
const ERROR_MS = 2000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** Browsers that reconnect within this window replay missed events. */
export const REPLAY_HOURS = 24;

/** Runs the outbox dispatcher loop inside the worker process. */
@Injectable()
export class OutboxService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Outbox');
  private running = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private pool: Pool | undefined;
  private redis: ReturnType<typeof createClient> | undefined;

  onApplicationBootstrap(): void {
    const config = parseEnvironment(process.env);
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
    this.redis = createClient({
      url: config.REDIS_URL,
      disableOfflineQueue: true,
      socket: { reconnectStrategy: (n: number) => Math.min(n * 100, 2000) },
    });
    this.redis.on('error', () => undefined);
    this.running = true;
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    const pool = this.pool;
    const redis = this.redis;
    if (!pool || !redis) return;
    let lastPrune = 0;
    let reported = false;
    while (this.running) {
      let delay = IDLE_MS;
      try {
        if (!redis.isOpen) await redis.connect();
        const result = await tracked('outbox', () =>
          dispatchBatch(pool, (channel, message) =>
            redis.publish(channel, message),
          ),
        );
        if (result.published > 0 && result.failed === 0) delay = 0;
        if (result.failed > 0) delay = ERROR_MS;
        if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
          await prunePublished(pool, REPLAY_HOURS);
          lastPrune = Date.now();
        }
        reported = false;
      } catch {
        if (!reported) this.logger.error('outbox dispatch failed; retrying');
        reported = true;
        delay = ERROR_MS;
      }
      if (delay > 0) await this.sleep(delay);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    if (this.redis?.isOpen) this.redis.destroy();
    await this.pool?.end();
  }
}
