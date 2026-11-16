import { expect, it } from 'vitest';
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
