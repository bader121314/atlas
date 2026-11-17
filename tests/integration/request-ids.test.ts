import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

describe('request ids', () => {
  it('are returned on every response, in problem details and in audit events', async () => {
    const fresh = await fx.api.api('GET', '/health/live');
    expect(fresh.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

    const missing = await fx.api.api('GET', '/organizations/nope', {
      headers: { 'x-request-id': 'support-ticket-42' },
    });
    expect(missing.headers.get('x-request-id')).toBe('support-ticket-42');
    expect(await missing.json()).toMatchObject({
      status: 401,
      requestId: 'support-ticket-42',
    });

    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const invited = await fx.api.api(
      'POST',
      `/organizations/${slug}/invitations`,
      {
        cookie: owner.cookie,
        headers: { 'x-request-id': 'invite-0001' },
        body: { email: 'traced@example.test', role: 'member' },
      },
    );
    expect(invited.status).toBe(201);
    const audit = await fx.db.query<{ request_id: string }>(
      `SELECT request_id FROM audit_events WHERE actor_user_id = $1 AND action = 'org.invitation.created'`,
      [owner.id],
    );
    expect(audit.rows[0]?.request_id).toBe('invite-0001');
  });
});
