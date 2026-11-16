import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { expect, it, vi } from 'vitest';
import { AppModule } from '../apps/api/src/app.module';
import { AppModule as WorkerModule } from '../apps/worker/src/app.module';
import { healthSchema } from '../packages/contracts/src';
import { ProblemFilter } from '../packages/shared/src';
it.each([
  [AppModule, 'api'],
  [WorkerModule, 'worker'],
] as const)(
  'serves health without exposing future endpoints (%s)',
  async (appModule, service) => {
    const module = await Test.createTestingModule({
      imports: [appModule],
    }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new ProblemFilter());
    await app.listen(0, '127.0.0.1');
    try {
      const base = await app.getUrl();
      const response = await fetch(base + '/v1/health/live');
      expect(response.status).toBe(200);
      expect(healthSchema.parse(await response.json())).toEqual({
        status: 'ok',
        service,
      });
      const missing = await fetch(base + '/v1/not-implemented');
      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-type')).toContain(
        'application/problem+json',
      );
      expect(await missing.json()).toEqual({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
      });
      vi.stubEnv(
        'DATABASE_URL',
        'postgresql://private-secret@127.0.0.1:1/unavailable',
      );
      vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');
      const readiness = await fetch(base + '/v1/health/ready');
      expect(readiness.status).toBe(503);
      expect(await readiness.json()).toEqual({
        type: 'about:blank',
        title: 'Service unavailable',
        status: 503,
      });
    } finally {
      vi.unstubAllEnvs();
      await app.close();
    }
  },
);
