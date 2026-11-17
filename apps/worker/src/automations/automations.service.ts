import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { parseEnvironment } from '@atlas/config';
import { runRecurrences } from '../recurrences/scheduler';
import { runAutomations } from './engine';

/** Runs automation rules (ADR-038) and recurring tasks (ADR-039). */
@Injectable()
export class AutomationsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Automations');
  private pool: Pool | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  onApplicationBootstrap(): void {
    const pool = new Pool({
      connectionString: parseEnvironment(process.env).DATABASE_URL,
      max: 2,
    });
    this.pool = pool;
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      Promise.all([runRecurrences(pool), runAutomations(pool)])
        .catch(() => this.logger.error('automations failed; retrying'))
        .finally(() => {
          this.busy = false;
        });
    }, 1000);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.pool?.end();
  }
}
