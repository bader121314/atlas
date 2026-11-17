import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { parseEnvironment } from '@atlas/config';
import { ObjectStore, storageSettings } from '@atlas/shared';
import { checkBatch, removeAbandoned } from './checker';

const CHECK_MS = 2000;
const CLEANUP_MS = 10 * 60 * 1000;

/** Runs attachment checks in the worker when storage is configured. */
@Injectable()
export class AttachmentChecksService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Attachments');
  private pool: Pool | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private busy = false;

  onApplicationBootstrap(): void {
    const settings = storageSettings(process.env);
    if (!settings) return;
    const store = new ObjectStore(settings);
    const pool = new Pool({
      connectionString: parseEnvironment(process.env).DATABASE_URL,
      max: 2,
    });
    this.pool = pool;
    const guarded = (run: () => Promise<unknown>) => async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        await run();
      } catch {
        this.logger.error('attachment checks failed; retrying');
      } finally {
        this.busy = false;
      }
    };
    this.timers.push(
      setInterval(
        guarded(() => checkBatch(pool, store)),
        CHECK_MS,
      ),
      setInterval(
        guarded(() => removeAbandoned(pool, store)),
        CLEANUP_MS,
      ),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.timers.forEach(clearInterval);
    await this.pool?.end();
  }
}
