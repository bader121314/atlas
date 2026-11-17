import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { parseEnvironment } from '@atlas/config';
import { tracked } from '../metrics';
import { dnsTxt, recheckDomains } from './rechecker';

/** Re-checks verified domains (ADR-057); each domain is due once a day. */
@Injectable()
export class DomainChecksService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Domains');
  private pool: Pool | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  onApplicationBootstrap(): void {
    const pool = new Pool({
      connectionString: parseEnvironment(process.env).DATABASE_URL,
      max: 1,
    });
    this.pool = pool;
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      tracked('domains', () => recheckDomains(pool, dnsTxt))
        .catch(() => this.logger.error('domain checks failed; retrying'))
        .finally(() => {
          this.busy = false;
        });
    }, 60_000);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.pool?.end();
  }
}
