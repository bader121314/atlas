import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { createClient } from 'redis';
import { parseEnvironment } from '@atlas/config';

export type RedisClient = ReturnType<typeof createClient>;
const CONNECT_TIMEOUT_MS = 2000;

// One lazily connected client per process. Commands fail fast while
// disconnected (no offline queue) so callers can fail closed promptly.
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger('Redis');
  private connection: Promise<RedisClient> | undefined;
  private reportedError = false;

  client(): Promise<RedisClient> {
    this.connection ??= this.connect().catch((error: unknown) => {
      this.connection = undefined;
      throw error;
    });
    return this.connection;
  }

  private async connect(): Promise<RedisClient> {
    const client = createClient({
      url: parseEnvironment(process.env).REDIS_URL,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        reconnectStrategy: (retries: number) => Math.min(retries * 100, 2000),
      },
    });
    client.on('error', () => {
      // Log once per outage without connection details.
      if (!this.reportedError) this.logger.error('redis connection error');
      this.reportedError = true;
    });
    client.on('ready', () => {
      this.reportedError = false;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('redis connect timeout')),
            CONNECT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      client.destroy();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return client;
  }

  async onApplicationShutdown(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (!connection) return;
    const client = await connection.catch(() => undefined);
    if (client?.isOpen) client.destroy();
  }
}
