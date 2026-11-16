import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, startAuthApp } from './support/auth-app';

let api: Awaited<ReturnType<typeof startAuthApp>>;
const NEW_PASSWORD = 'a completely different passphrase';

beforeAll(async () => {
  api = await startAuthApp();
});

afterAll(async () => {
  await api.close();
});

async function sessionStatus(cookie: string): Promise<number> {
  return (await api.request('GET', '/session', { cookie })).status;
}

describe('password reset', () => {
  it('sets a new password and signs out every device', async () => {
    const email = await api.verifiedAccount('reset');
    const laptop = await api.login(email);
    const phone = await api.login(email);

    const requested = await api.request('POST', '/password-reset/request', {
      body: { email },
    });
    expect(requested.status).toBe(202);
    const token = api.mailer.token(email, '/reset-password');

    const confirmed = await api.request('POST', '/password-reset/confirm', {
      body: { token, password: NEW_PASSWORD },
    });
    expect(confirmed.status).toBe(204);

    expect(await sessionStatus(laptop)).toBe(401);
    expect(await sessionStatus(phone)).toBe(401);
    await expect(api.login(email)).rejects.toThrow('login 401');
    expect(await api.login(email, NEW_PASSWORD)).toMatch(/^atlas_session=/);

    // Reset links are single use.
    const reuse = await api.request('POST', '/password-reset/confirm', {
      body: { token, password: 'yet another long password' },
    });
    expect(reuse.status).toBe(400);
  });

  it('invalidates an earlier link when a new one is requested', async () => {
    const email = await api.verifiedAccount('reset-twice');
    const body = { email };
    await api.request('POST', '/password-reset/request', { body });
    const first = api.mailer.token(email, '/reset-password');
    await api.request('POST', '/password-reset/request', { body });
    const second = api.mailer.token(email, '/reset-password');
    expect(second).not.toBe(first);
    const stale = await api.request('POST', '/password-reset/confirm', {
      body: { token: first, password: NEW_PASSWORD },
    });
    expect(stale.status).toBe(400);
    const fresh = await api.request('POST', '/password-reset/confirm', {
      body: { token: second, password: NEW_PASSWORD },
    });
    expect(fresh.status).toBe(204);
  });

  it('does not burn the token when the new password is rejected', async () => {
    const email = await api.verifiedAccount('reset-weak');
    await api.request('POST', '/password-reset/request', { body: { email } });
    const token = api.mailer.token(email, '/reset-password');
    const weak = await api.request('POST', '/password-reset/confirm', {
      body: { token, password: 'short' },
    });
    expect(weak.status).toBe(400);
    const retry = await api.request('POST', '/password-reset/confirm', {
      body: { token, password: NEW_PASSWORD },
    });
    expect(retry.status).toBe(204);
  });

  it('answers identically and sends nothing for unknown or unverified emails', async () => {
    const unverified = api.email('reset-unverified');
    await api.request('POST', '/signup', {
      body: { email: unverified, password: PASSWORD, displayName: 'U' },
    });
    const before = api.mailer.sent.length;
    for (const email of [unverified, api.email('reset-unknown')]) {
      const response = await api.request('POST', '/password-reset/request', {
        body: { email },
      });
      expect(response.status).toBe(202);
      expect(await response.text()).toBe('');
    }
    expect(api.mailer.sent.length).toBe(before);
  });
});

describe('session management', () => {
  it('lists own sessions and marks the current one', async () => {
    const email = await api.verifiedAccount('list');
    const first = await api.login(email);
    await api.login(email);
    const response = await api.request('GET', '/sessions', { cookie: first });
    expect(response.status).toBe(200);
    const { sessions } = (await response.json()) as {
      sessions: { id: string; current: boolean }[];
    };
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it('revokes a chosen session and all other sessions', async () => {
    const email = await api.verifiedAccount('revoke');
    const keep = await api.login(email);
    const lost = await api.login(email);
    const another = await api.login(email);
    const list = await api.request('GET', '/sessions', { cookie: lost });
    const { sessions } = (await list.json()) as {
      sessions: { id: string; current: boolean }[];
    };
    const lostId = sessions.find((s) => s.current)?.id ?? '';

    const revoked = await api.request('DELETE', `/sessions/${lostId}`, {
      cookie: keep,
    });
    expect(revoked.status).toBe(204);
    expect(await sessionStatus(lost)).toBe(401);
    expect(await sessionStatus(another)).toBe(200);

    const others = await api.request('POST', '/sessions/revoke-others', {
      cookie: keep,
    });
    expect(others.status).toBe(204);
    expect(await sessionStatus(another)).toBe(401);
    expect(await sessionStatus(keep)).toBe(200);
  });

  it("cannot see or revoke another user's session", async () => {
    const victim = await api.login(await api.verifiedAccount('victim'));
    const attacker = await api.login(await api.verifiedAccount('attacker'));
    const victimList = await api.request('GET', '/sessions', {
      cookie: victim,
    });
    const { sessions } = (await victimList.json()) as {
      sessions: { id: string }[];
    };
    const victimSessionId = sessions[0]?.id ?? '';

    const attackerList = await api.request('GET', '/sessions', {
      cookie: attacker,
    });
    const visible = (await attackerList.json()) as {
      sessions: { id: string }[];
    };
    expect(visible.sessions.map((s) => s.id)).not.toContain(victimSessionId);

    const attempt = await api.request(
      'DELETE',
      `/sessions/${victimSessionId}`,
      {
        cookie: attacker,
      },
    );
    expect(attempt.status).toBe(404);
    expect(await sessionStatus(victim)).toBe(200);
  });

  it('answers 404 for malformed session ids and 401 without a session', async () => {
    const cookie = await api.login(await api.verifiedAccount('malformed'));
    const malformed = await api.request('DELETE', '/sessions/not-a-uuid', {
      cookie,
    });
    expect(malformed.status).toBe(404);
    expect((await api.request('GET', '/sessions')).status).toBe(401);
  });
});
