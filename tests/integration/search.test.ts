import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';
import type { Account } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

interface Hit {
  key: string;
  title: string;
  matchedIn: string;
}

describe('search', () => {
  it('finds tasks by title, description, comment or key, and hides private projects', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const member = await fx.join(slug, owner, 'member');
    const project = (key: string, visibility: string) =>
      fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
        key,
        name: key,
        visibility,
      });
    await project('OPEN', 'organization');
    await project('SECRET', 'private');
    const task = (key: string, body: Record<string, unknown>) =>
      fx.call(
        owner,
        'POST',
        `/organizations/${slug}/projects/${key}/tasks`,
        body,
      );
    await task('OPEN', { title: 'Survey the northern bay' });
    await task('OPEN', {
      title: 'Order buoys',
      description: 'Bay markers are worn',
    });
    await task('OPEN', { title: 'مسح الخليج' });
    await task('SECRET', { title: 'Bay acquisition plan' });
    await fx.call(
      owner,
      'POST',
      `/organizations/${slug}/projects/OPEN/tasks/2/comments`,
      {
        body: 'Supplier quoted for lighthouse lamps',
      },
    );
    const deleted = (
      await fx.call(
        owner,
        'POST',
        `/organizations/${slug}/projects/OPEN/tasks/1/comments`,
        {
          body: 'zeppelin',
        },
      )
    ).json as { id: string };
    await fx.call(
      owner,
      'DELETE',
      `/organizations/${slug}/projects/OPEN/tasks/1/comments/${deleted.id}`,
    );

    const search = async (who: Account, q: string) => {
      const response = await fx.call(
        who,
        'GET',
        `/organizations/${slug}/search?q=${encodeURIComponent(q)}`,
      );
      return { status: response.status, hits: (response.json ?? []) as Hit[] };
    };

    // Title matches rank above description matches.
    expect((await search(member, 'bay')).hits.map((h) => h.key)).toEqual([
      'OPEN-1',
      'OPEN-2',
    ]);
    expect((await search(owner, 'bay')).hits.map((h) => h.key).sort()).toEqual(
      ['OPEN-1', 'OPEN-2', 'SECRET-1'].sort(),
    );
    expect((await search(member, 'acquisition')).hits).toEqual([]);
    expect((await search(member, 'SECRET-1')).hits).toEqual([]);

    expect((await search(member, 'surv north')).hits.map((h) => h.key)).toEqual(
      ['OPEN-1'],
    );
    expect((await search(member, 'lighthouse')).hits).toEqual([
      expect.objectContaining({ key: 'OPEN-2', matchedIn: 'comment' }),
    ]);
    expect((await search(member, 'zeppelin')).hits).toEqual([]);
    expect((await search(member, 'الخل')).hits.map((h) => h.key)).toEqual([
      'OPEN-3',
    ]);
    expect((await search(member, 'open-2')).hits[0]).toMatchObject({
      key: 'OPEN-2',
      title: 'Order buoys',
    });
    expect((await search(member, "') | !")).hits).toEqual([]);
    expect((await search(member, ' ')).status).toBe(400);

    // Another organization's tasks never appear.
    const stranger = await fx.account('stranger');
    const otherSlug = await fx.organization(stranger);
    await fx.call(stranger, 'POST', `/organizations/${otherSlug}/projects`, {
      key: 'OPEN',
      name: 'Theirs',
    });
    await fx.call(
      stranger,
      'POST',
      `/organizations/${otherSlug}/projects/OPEN/tasks`,
      { title: 'Bay too' },
    );
    expect(
      (await search(owner, 'bay')).hits.some((h) => h.title === 'Bay too'),
    ).toBe(false);
    expect((await search(stranger, 'bay')).status).toBe(404);
  });
});
