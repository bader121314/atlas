import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { parseEnvironment } from '@atlas/config';
import { ObjectStore, scannerFromEnv, storageSettings } from '@atlas/shared';
import { expireExports, runExports } from '../exports/exporter';
import { checkBatch, removeAbandoned } from './checker';
import { tracked } from '../metrics';

const CHECK_MS = 2000;
const CLEANUP_MS = 10 * 60 * 1000;

/**
 * Storage jobs in the worker when storage is configured: attachment checks
 * (ADR-034) and task exports (ADR-035).
 */
@Injectable()
export class AttachmentChecksService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Attachments');
  private pool: Pool | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly busy = new Set<string>();

  onApplicationBootstrap(): void {
    const settings = storageSettings(process.env);
    if (!settings) return;
    const store = new ObjectStore(settings);
    const scanner = scannerFromEnv(process.env);
    if (scanner.name === 'eicar' && process.env.NODE_ENV === 'production')
      this.logger.warn(
        'CLAMD_HOST is not set: uploads are checked for the EICAR test file only',
      );
    const pool = new Pool({
      connectionString: parseEnvironment(process.env).DATABASE_URL,
      max: 2,
    });
    this.pool = pool;
    // One flag per job: a slow job skips its own next turn, never another's.
    const guarded = (name: string, run: () => Promise<unknown>) => async () => {
      if (this.busy.has(name)) return;
      this.busy.add(name);
      try {
        await tracked(name, run);
      } catch {
        this.logger.error('attachment checks failed; retrying');
      } finally {
        this.busy.delete(name);
      }
    };
    this.timers.push(
      setInterval(
        guarded('check', () => checkBatch(pool, store, { scanner })),
        CHECK_MS,
      ),
      setInterval(
        guarded('export', () => runExports(pool, store)),
        CHECK_MS,
      ),
      setInterval(
        guarded('cleanup', async () => {
          await removeAbandoned(pool, store);
          await expireExports(pool, store);
        }),
        CLEANUP_MS,
      ),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.timers.forEach(clearInterval);
    await this.pool?.end();
  }
}
