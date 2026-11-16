import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { AppModule } from '../../apps/api/src/app.module';
import { Mailer } from '../../apps/api/src/auth/mailer';
import type { MailMessage } from '../../apps/api/src/auth/mailer';
import { parseEnvironment } from '../../packages/config/src';
import { digestToken, ProblemFilter } from '../../packages/shared/src';

const ORIGIN = 'http://localhost:3000';
const SECRET = 'integration-test-secret-'.padEnd(48, 'x');

class CapturingMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

const mailer = new CapturingMailer();
const db = new Client({
  connectionString: parseEnvironment(process.env).DATABASE_URL,
});
let app: INestApplication;
let base: string;
const run = randomUUID().slice(0, 8);
const emails: string[] = [];

beforeAll(async () => {
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('WEB_ORIGIN', ORIGIN);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ProblemFilter());
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()) + '/v1/auth';
  await db.connect();
});

afterAll(async () => {
  try {
    if (emails.length > 0) {
      await db.query('DELETE FROM users WHERE email_normalized = ANY($1)', [
        emails,
      ]);
    }
  } finally {
    await db.end();
    await app.close();
    vi.unstubAllEnvs();
  }
});

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function newEmail(label: string): string {
  const email = `${label}-${run}@example.test`;
  emails.push(email);
  return email;
}

function cookieFrom(response: Response): string {
  const value = response.headers.get('set-cookie') ?? '';
  return value.split(';')[0] ?? '';
}

function tokenFromMail(to: string): string {
  const message = mailer.sent.filter((m) => m.to === to).at(-1);
  const token = /token=([A-Za-z0-9_-]+)/.exec(message?.text ?? '')?.[1];
  if (!token) throw new Error('no verification token captured');
  return token;
}

const password = 'a sufficiently long password';

async function verifiedAccount(label: string): Promise<string> {
  const email = newEmail(label);
  await post('/signup', { email, password, displayName: label });
  await post('/verify-email', { token: tokenFromMail(email) });
  return email;
}

describe('signup, verification and sessions', () => {
  it('runs the full account lifecycle', async () => {
    const email = newEmail('lifecycle');
    const signup = await post('/signup', {
      email: email.toUpperCase(),
      password,
      displayName: 'Lifecycle',
    });
    expect(signup.status).toBe(202);

    // Unverified accounts cannot sign in.
    expect((await post('/login', { email, password })).status).toBe(401);

    const token = tokenFromMail(email);
    expect((await post('/verify-email', { token })).status).toBe(204);
    // Verification links are single use.
    expect((await post('/verify-email', { token })).status).toBe(400);

    const login = await post('/login', { email, password });
    expect(login.status).toBe(204);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const cookie = cookieFrom(login);

    const session = await fetch(base + '/session', { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({
      user: { id: expect.any(String), email, displayName: 'Lifecycle' },
    });

    expect((await post('/logout', {}, { cookie })).status).toBe(204);
    const after = await fetch(base + '/session', { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it('stores only a keyed digest of the session token', async () => {
    const email = await verifiedAccount('digest');
    const login = await post('/login', { email, password });
    const raw = cookieFrom(login).split('=')[1] ?? '';
    const stored = await db.query<{ token_hash: Buffer }>(
      `SELECT s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE u.email_normalized = $1`,
      [email],
    );
    expect(stored.rows).toHaveLength(1);
    const hash = stored.rows[0]?.token_hash;
    expect(hash?.equals(digestToken(raw, SECRET))).toBe(true);
    expect(hash?.toString('utf8')).not.toContain(raw);
  });
});

describe('account enumeration resistance', () => {
  it('answers signup identically for new and existing emails', async () => {
    const email = await verifiedAccount('existing');
    const before = mailer.sent.length;
    const again = await post('/signup', {
      email,
      password,
      displayName: 'Someone else',
    });
    expect(again.status).toBe(202);
    expect(await again.text()).toBe('');
    // No second email and the original account is untouched.
    expect(mailer.sent.length).toBe(before);
    expect((await post('/login', { email, password })).status).toBe(204);
  });

  it('answers login identically for unknown email and wrong password', async () => {
    const email = await verifiedAccount('wrong-password');
    const wrong = await post('/login', { email, password: 'not the password' });
    const unknown = await post('/login', {
      email: `nobody-${run}@example.test`,
      password,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });
});

describe('request hardening', () => {
  it('rejects state-changing requests from other or missing origins', async () => {
    const email = newEmail('origin');
    const body = { email, password, displayName: 'Origin' };
    const foreign = await post('/signup', body, {
      origin: 'https://attacker.example',
    });
    expect(foreign.status).toBe(403);
    const missing = await fetch(base + '/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(missing.status).toBe(403);
    expect(mailer.sent.some((m) => m.to === email)).toBe(false);
  });

  it('rejects invalid input and unknown fields', async () => {
    const email = newEmail('invalid');
    for (const body of [
      { email, password: 'short', displayName: 'Short' },
      { email: 'not-an-email', password, displayName: 'Bad' },
      { email, password, displayName: 'Extra', role: 'owner' },
    ]) {
      expect((await post('/signup', body)).status).toBe(400);
    }
  });

  it('rejects forged or missing session cookies', async () => {
    const forged = await fetch(base + '/session', {
      headers: { cookie: 'atlas_session=forged-token' },
    });
    expect(forged.status).toBe(401);
    expect((await fetch(base + '/session')).status).toBe(401);
    expect((await post('/logout', {})).status).toBe(401);
  });
});
