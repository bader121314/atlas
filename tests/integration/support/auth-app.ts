import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { Client } from 'pg';
import { AppModule } from '../../../apps/api/src/app.module';
import { Mailer } from '../../../apps/api/src/auth/mailer';
import type { MailMessage } from '../../../apps/api/src/auth/mailer';
import {
  DEFAULT_RATE_LIMITS,
  RateLimitSettings,
} from '../../../apps/api/src/rate-limit/rate-limit.service';
import { parseEnvironment } from '../../../packages/config/src';
import { ProblemFilter, requestLogging } from '../../../packages/shared/src';

export const ORIGIN = 'http://localhost:3000';
export const SECRET = 'integration-test-secret-'.padEnd(48, 'x');
export const PASSWORD = 'a sufficiently long password';

export class CapturingMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Extracts the token from the latest message to `to` for a link path. */
  token(to: string, path: string): string {
    const message = this.sent.filter((m) => m.to === to).at(-1);
    const pattern = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`);
    const token = pattern.exec(message?.text ?? '')?.[1];
    if (!token) throw new Error(`no ${path} token captured`);
    return token;
  }
}

type App = ReturnType<TestingModule['createNestApplication']>;
interface RequestOptions {
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
}

/**
 * Starts the real API module against the CI database and Redis with a
 * capturing mailer and generous, isolated rate limits.
 */
export async function startAuthApp() {
  const run = randomUUID().slice(0, 8);
  const mailer = new CapturingMailer();
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('WEB_ORIGIN', ORIGIN);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(RateLimitSettings)
    .useValue({
      prefix: `test:${run}:`,
      rules: Object.fromEntries(
        Object.keys(DEFAULT_RATE_LIMITS).map((name) => [
          name,
          { limit: 1000, windowSeconds: 60 },
        ]),
      ),
    })
    .compile();
  const app: App = module.createNestApplication();
  app.use(requestLogging(() => undefined, false));
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ProblemFilter());
  await app.listen(0, '127.0.0.1');
  const root = (await app.getUrl()) + '/v1';

  /** Calls `/v1/auth{path}`. */
  function request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    return api(method, `/auth${path}`, options);
  }

  /** Calls `/v1{path}` with the allowed Origin and optional session cookie. */
  function api(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      origin: ORIGIN,
      ...options.headers,
    };
    if (options.cookie) headers.cookie = options.cookie;
    if (options.body !== undefined)
      headers['content-type'] = 'application/json';
    return fetch(root + path, {
      method,
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  }

  function email(label: string): string {
    return `${label}-${run}@example.test`;
  }

  async function verifiedAccount(label: string): Promise<string> {
    const address = email(label);
    await request('POST', '/signup', {
      body: { email: address, password: PASSWORD, displayName: label },
    });
    await request('POST', '/verify-email', {
      body: { token: mailer.token(address, '/verify-email') },
    });
    return address;
  }

  async function login(address: string, password = PASSWORD): Promise<string> {
    const response = await request('POST', '/login', {
      body: { email: address, password },
    });
    if (response.status !== 204) throw new Error(`login ${response.status}`);
    return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }

  async function close(): Promise<void> {
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
      await app.close();
      vi.unstubAllEnvs();
    }
  }

  return { mailer, request, api, email, verifiedAccount, login, close, root };
}
