import { Client } from 'pg';
import { createClient } from 'redis';
import { parseEnvironment } from '@atlas/config';

export async function checkDependencies(): Promise<void> {
  const config = parseEnvironment(process.env);
  const db = new Client({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  });
  const redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
  });
  redis.on('error', () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const connections = await Promise.allSettled([
      db.connect(),
      redis.connect(),
    ]);
    if (connections.some((result) => result.status === 'rejected')) {
      throw new Error('Dependency unavailable');
    }
    await Promise.all([
      db.query('SELECT 1'),
      Promise.race([
        redis.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Redis timed out')), 2000);
        }),
      ]).then((result) => {
        if (result !== 'PONG') throw new Error('Redis unavailable');
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await db.end();
    if (redis.isOpen) redis.destroy();
  }
}
