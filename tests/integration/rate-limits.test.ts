import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../apps/api/src/app.module';
import { Mailer } from '../../apps/api/src/auth/mailer';
import type { MailMessage } from '../../apps/api/src/auth/mailer';
import {
  DEFAULT_RATE_LIMITS,
  RateLimitSettings,
} from '../../apps/api/src/rate-limit/rate-limit.service';
import type { RateLimitName } from '../../apps/api/src/rate-limit/rate-limit.service';
import { Client } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { ProblemFilter } from '../../packages/shared/src';

const ORIGIN = 'http://localhost:3000';
const run = randomUUID().slice(0, 8);
type App = ReturnType<TestingModule['createNestApplication']>;
const apps: App[] = [];

class CapturingMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

// Tight limits for the rules under test; everything else stays generous.
function settings(overrides: Partial<Record<RateLimitName, number>>) {
  return {
    prefix: `test:limits:${run}:${randomUUID().slice(0, 8)}:`,
    rules: Object.fromEntries(
      (Object.keys(DEFAULT_RATE_LIMITS) as RateLimitName[]).map((name) => [
        name,
        { limit: overrides[name] ?? 1000, windowSeconds: 60 },
      ]),
    ),
  };
}

async function start(
  overrides: Partial<Record<RateLimitName, number>>,
  mailer = new CapturingMailer(),
): Promise<(path: string, body: unknown) => Promise<Response>> {
  vi.stubEnv('SESSION_SECRET', 'rate-limit-test-secret-'.padEnd(48, 'x'));
  vi.stubEnv('WEB_ORIGIN', ORIGIN);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(RateLimitSettings)
    .useValue(settings(overrides))
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ProblemFilter());
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  const base = (await app.getUrl()) + '/v1/auth';
  return (path, body) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(body),
    });
}

afterAll(async () => {
  for (const app of apps) await app.close();
  vi.unstubAllEnvs();
  const db = new Client({
    connectionString: parseEnvironment(process.env).DATABASE_URL,
  });
  await db.connect();
  try {
    await db.query('DELETE FROM users WHERE email_normalized LIKE $1', [
      `%-${run}@example.test`,
    ]);
  } finally {
    await db.end();
  }
});

const password = 'a sufficiently long password';

describe('rate limits', () => {
  it('limits login attempts per account with 429 and Retry-After', async () => {
    const post = await start({ loginPerAccount: 2 });
    const email = `target-${run}@example.test`;
    expect((await post('/login', { email, password })).status).toBe(401);
    expect((await post('/login', { email, password })).status).toBe(401);
    const limited = await post('/login', { email, password });
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await limited.json()).toEqual({
      type: 'about:blank',
      title: 'Too many requests',
      status: 429,
    });
    // Another account from the same address is unaffected.
    const other = await post('/login', {
      email: `other-${run}@example.test`,
      password,
    });
    expect(other.status).toBe(401);
  });

  it('treats email case variants as the same account', async () => {
    const post = await start({ loginPerAccount: 1 });
    const email = `case-${run}@example.test`;
    expect((await post('/login', { email, password })).status).toBe(401);
    const upper = await post('/login', {
      email: email.toUpperCase(),
      password,
    });
    expect(upper.status).toBe(429);
  });

  it('limits signups per address before any email is sent', async () => {
    const mailer = new CapturingMailer();
    const post = await start({ signupPerIp: 2 }, mailer);
    for (const label of ['one', 'two']) {
      const response = await post('/signup', {
        email: `${label}-${run}@example.test`,
        password,
        displayName: label,
      });
      expect(response.status).toBe(202);
    }
    const limited = await post('/signup', {
      email: `three-${run}@example.test`,
      password,
      displayName: 'three',
    });
    expect(limited.status).toBe(429);
    expect(mailer.sent.map((m) => m.to)).toEqual([
      `one-${run}@example.test`,
      `two-${run}@example.test`,
    ]);
  });

  it('fails closed with 503 when Redis is unavailable', async () => {
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');
    const post = await start({});
    const response = await post('/login', {
      email: `outage-${run}@example.test`,
      password,
    });
    expect(response.status).toBe(503);
  });
});
