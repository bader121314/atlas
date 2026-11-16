import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { parseEnvironment } from '@atlas/config';

// Repositories use parameterized SQL through one pool. Prisma owns the schema
// and migrations; see ADR-011. The pool is created on first use so modules
// that never touch the database (for example health tests) need no URL.
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private poolInstance: Pool | undefined;

  get pool(): Pool {
    this.poolInstance ??= new Pool({
      connectionString: parseEnvironment(process.env).DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
    });
    return this.poolInstance;
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.poolInstance?.end();
  }
}
