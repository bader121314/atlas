import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD } from './support/auth-app';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

describe('change password while signed in', () => {
  it('needs the current password and signs out other devices', async () => {
    const me = await fx.account('me');
    const otherDevice = await fx.api.login(me.email);
    const change = (body: unknown) =>
      fx.api.api('POST', '/auth/password', { cookie: me.cookie, body });

    expect(
      (
        await change({
          currentPassword: 'wrong password!!',
          newPassword: 'a brand new passphrase',
        })
      ).status,
    ).toBe(400);
    expect(
      (await change({ currentPassword: PASSWORD, newPassword: 'short' }))
        .status,
    ).toBe(400);
    expect(
      (
        await change({
          currentPassword: PASSWORD,
          newPassword: 'a brand new passphrase',
        })
      ).status,
    ).toBe(204);

    expect(
      (await fx.api.api('GET', '/auth/session', { cookie: me.cookie })).status,
    ).toBe(200);
    expect(
      (await fx.api.api('GET', '/auth/session', { cookie: otherDevice }))
        .status,
    ).toBe(401);
    await expect(fx.api.login(me.email)).rejects.toThrow();
    expect(await fx.api.login(me.email, 'a brand new passphrase')).toContain(
      '=',
    );

    const audit = await fx.db.query<{
      metadata: { otherSessionsRevoked: number };
    }>(
      `SELECT metadata FROM audit_events WHERE actor_user_id = $1 AND action = 'auth.password.changed'`,
      [me.id],
    );
    expect(audit.rows[0]?.metadata.otherSessionsRevoked).toBe(1);
    expect(
      (await fx.api.api('POST', '/auth/password', { body: {} })).status,
    ).toBe(401);
  });
});
