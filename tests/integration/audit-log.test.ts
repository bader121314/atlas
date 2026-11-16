import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, DatabaseError } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { PASSWORD, startAuthApp } from './support/auth-app';

let api: Awaited<ReturnType<typeof startAuthApp>>;
const db = new Client({
  connectionString: parseEnvironment(process.env).DATABASE_URL,
});

beforeAll(async () => {
  api = await startAuthApp();
  await db.connect();
});

afterAll(async () => {
  await db.end();
  await api.close();
});

interface AuditRow {
  action: string;
  actor_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  ip_summary: string | null;
  metadata: Record<string, unknown>;
}

async function userId(email: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE email_normalized = $1',
    [email],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('user not found');
  return id;
}

async function eventsFor(id: string): Promise<AuditRow[]> {
  const result = await db.query<AuditRow>(
    `SELECT action, actor_user_id, target_type, target_id, ip_summary, metadata
     FROM audit_events
     WHERE actor_user_id = $1 OR (target_type = 'user' AND target_id = $1)
     ORDER BY occurred_at, action`,
    [id],
  );
  return result.rows;
}

describe('audit log', () => {
  it('records the account lifecycle without secrets', async () => {
    const email = await api.verifiedAccount('audited');
    const id = await userId(email);
    const wrong = await api.request('POST', '/login', {
      body: { email, password: 'definitely the wrong password' },
    });
    expect(wrong.status).toBe(401);
    const cookie = await api.login(email);
    await api.request('POST', '/logout', { cookie });

    const events = await eventsFor(id);
    expect(events.map((e) => e.action)).toEqual([
      'auth.signup.created',
      'auth.email.verified',
      'auth.login.failed',
      'auth.login.succeeded',
      'auth.logout',
    ]);
    const failed = events.find((e) => e.action === 'auth.login.failed');
    expect(failed?.actor_user_id).toBeNull();
    expect(failed?.metadata).toEqual({ reason: 'invalid_password' });
    const login = events.find((e) => e.action === 'auth.login.succeeded');
    expect(login?.target_type).toBe('session');
    expect(login?.ip_summary).toBe('127.0.0.0/24');

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(cookie.split('=')[1] ?? cookie);
  });

  it('records failed logins for unknown accounts without identifying anyone', async () => {
    // A unique user agent isolates this request from other test files that
    // run in parallel against the same database.
    const marker = `audit-test-${randomUUID()}`;
    await api.request('POST', '/login', {
      body: { email: api.email('ghost'), password: PASSWORD },
      headers: { 'user-agent': marker },
    });
    const rows = await db.query<AuditRow>(
      `SELECT action, actor_user_id, target_type, target_id, ip_summary, metadata
       FROM audit_events WHERE user_agent_summary = $1`,
      [marker],
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        action: 'auth.login.failed',
        actor_user_id: null,
        target_type: null,
        target_id: null,
        metadata: { reason: 'unknown_account' },
      }),
    ]);
  });

  it('records how many sessions a password reset revoked', async () => {
    const email = await api.verifiedAccount('audit-reset');
    await api.login(email);
    await api.login(email);
    await api.request('POST', '/password-reset/request', { body: { email } });
    await api.request('POST', '/password-reset/confirm', {
      body: {
        token: api.mailer.token(email, '/reset-password'),
        password: 'a brand new long password',
      },
    });
    const events = await eventsFor(await userId(email));
    expect(events.map((e) => e.action)).toContain(
      'auth.password_reset.requested',
    );
    const completed = events.find(
      (e) => e.action === 'auth.password_reset.completed',
    );
    expect(completed?.metadata).toEqual({ sessionsRevoked: 2 });
  });

  it('records session revocations', async () => {
    const email = await api.verifiedAccount('audit-sessions');
    const keep = await api.login(email);
    await api.login(email);
    await api.request('POST', '/sessions/revoke-others', { cookie: keep });
    const events = await eventsFor(await userId(email));
    const revoked = events.find(
      (e) => e.action === 'auth.sessions.revoked_others',
    );
    expect(revoked?.metadata).toEqual({ sessionsRevoked: 1 });
  });

  it('cannot be edited, deleted or truncated', async () => {
    for (const statement of [
      "UPDATE audit_events SET action = 'auth.tampered.event'",
      'DELETE FROM audit_events',
      'TRUNCATE audit_events',
    ]) {
      const error: unknown = await db.query(statement).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).code).toBe('42501');
    }
  });
});
