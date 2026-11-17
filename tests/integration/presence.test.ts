import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from 'redis';
import { parseEnvironment } from '../../packages/config/src';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
let redis: ReturnType<typeof createClient>;
beforeAll(async () => {
  fx = await startFixtures();
  redis = createClient({ url: parseEnvironment(process.env).REDIS_URL });
  await redis.connect();
});
afterAll(async () => {
  redis.destroy();
  await fx.close();
});

type Viewers = { viewers: { userId: string; displayName: string }[] };

describe('task presence', () => {
  it('shows who is viewing a task until they leave or go quiet', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const base = `/organizations/${slug}/projects/PRS`;
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'PRS',
      name: 'Presence',
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'One' });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Two' });
    const member = await fx.join(slug, owner, 'member');
    const here = async (who: typeof owner, n = 1) =>
      (
        (await fx.call(who, 'PUT', `${base}/tasks/${n}/presence`))
          .json as Viewers
      ).viewers.map((v) => v.userId);

    expect(await here(owner)).toEqual([owner.id]);
    expect((await here(member)).sort()).toEqual([owner.id, member.id].sort());
    // Viewers of another task are separate.
    expect(await here(member, 2)).toEqual([member.id]);

    expect(
      (await fx.call(member, 'DELETE', `${base}/tasks/1/presence`)).status,
    ).toBe(204);
    expect(await here(owner)).toEqual([owner.id]);

    // A viewer whose heartbeat expired drops off.
    const task = await fx.db.query<{ id: string; organization_id: string }>(
      `SELECT t.id, t.organization_id FROM tasks t JOIN organizations o ON o.id = t.organization_id
       WHERE o.slug = $1 AND t.number = 1`,
      [slug],
    );
    const row = task.rows[0];
    await redis.zAdd(`atlas:presence:${row?.organization_id}:${row?.id}`, {
      score: Date.now() - 1000,
      value: member.id,
    });
    expect(await here(owner)).toEqual([owner.id]);
  });

  it('hides presence from outsiders and unknown tasks', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const base = `/organizations/${slug}/projects/HID`;
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'HID',
      name: 'Hidden',
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'One' });
    const outsider = await fx.account('outsider');
    expect(
      (await fx.call(outsider, 'PUT', `${base}/tasks/1/presence`)).status,
    ).toBe(404);
    expect(
      (await fx.call(owner, 'PUT', `${base}/tasks/99/presence`)).status,
    ).toBe(404);
  });
});
