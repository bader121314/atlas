import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PASSWORD } from './support/auth-app';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fx.close();
});

describe('demo mode (ADR-062)', () => {
  it('is off unless configured', async () => {
    expect((await fx.api.request('GET', '/demo')).status).toBe(404);
  });

  it('shows the shared account, closes sign-ups and drops email', async () => {
    vi.stubEnv('DEMO_EMAIL', 'demo@atlas.example');
    vi.stubEnv('DEMO_PASSWORD', 'Demo-shared-secret');
    vi.stubEnv('SIGNUPS_CLOSED', 'true');
    const demo = await fx.api.request('GET', '/demo');
    expect(demo.status).toBe(200);
    expect(await demo.json()).toEqual({
      email: 'demo@atlas.example',
      password: 'Demo-shared-secret',
    });
    const email = `closed-${Date.now()}@example.test`;
    expect(
      (
        await fx.api.request('POST', '/signup', {
          body: { email, password: PASSWORD, displayName: 'Closed' },
        })
      ).status,
    ).toBe(403);
    vi.unstubAllEnvs();
  });
});
