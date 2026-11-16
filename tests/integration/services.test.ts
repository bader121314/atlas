import 'reflect-metadata';
import { expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule as ApiModule } from '../../apps/api/src/app.module';
import { AppModule as WorkerModule } from '../../apps/worker/src/app.module';
import { Client } from 'pg';
import { createClient } from 'redis';
import { parseEnvironment } from '../../packages/config/src';
it('applies the baseline to PostgreSQL and reaches Redis', async () => {
  const config = parseEnvironment(process.env);
  const db = new Client({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 3000,
  });
  const redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  });
  redis.on('error', () => {});
  try {
    await db.connect();
    await redis.connect();
    const result = await db.query(
      "SELECT to_regclass('public.system_metadata') AS name",
    );
    expect(result.rows[0]?.name).toBe('system_metadata');
    expect(await redis.ping()).toBe('PONG');
  } finally {
    await db.end();
    if (redis.isOpen) await redis.quit();
  }
});

it.each([
  [ApiModule, 'api'],
  [WorkerModule, 'worker'],
] as const)(
  'reports readiness with live dependencies (%s)',
  async (appModule, service) => {
    const module = await Test.createTestingModule({
      imports: [appModule],
    }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    try {
      const response = await fetch((await app.getUrl()) + '/v1/health/ready');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', service });
    } finally {
      await app.close();
    }
  },
);
