import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

interface Person {
  userId: string;
  overdue: number;
  weeks: number[];
  later: number;
  noDueDate: number;
  total: number;
}

describe('workload', () => {
  it('counts open assigned work per week, only in projects the viewer can open', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const a = await fx.join(slug, owner, 'member');
    const b = await fx.join(slug, owner, 'member');
    const viewer = await fx.join(slug, owner, 'member');
    const project = (key: string, visibility: string) =>
      fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
        key,
        name: key,
        visibility,
      });
    await project('OPEN', 'organization');
    await project('SECRET', 'private');
    await fx.call(
      owner,
      'PUT',
      `/organizations/${slug}/projects/SECRET/members/${b.id}`,
      { role: 'editor' },
    );
    const task = (key: string, assigneeId: string, days: number | null) =>
      fx.call(owner, 'POST', `/organizations/${slug}/projects/${key}/tasks`, {
        title: `T ${days}`,
        assigneeId,
        dueAt:
          days === null
            ? null
            : new Date(Date.now() + days * 86_400_000).toISOString(),
      });
    await task('OPEN', a.id, -10);
    await task('OPEN', a.id, 0);
    await task('OPEN', a.id, 7);
    await task('OPEN', a.id, 200);
    await task('OPEN', a.id, null);
    await task('SECRET', b.id, 1);
    // Finished work does not count.
    const states = (
      await fx.call(owner, 'GET', `/organizations/${slug}/projects/OPEN/states`)
    ).json as {
      id: string;
      category: string;
    }[];
    const done = await task('OPEN', a.id, 1);
    await fx.call(
      owner,
      'PATCH',
      `/organizations/${slug}/projects/OPEN/tasks/6`,
      {
        version: (done.json as { version: number }).version,
        stateId: states.find((s) => s.category === 'done')?.id,
      },
    );

    const view = async (who: typeof owner) =>
      (await fx.call(who, 'GET', `/organizations/${slug}/workload?weeks=4`))
        .json as {
        weekStarts: string[];
        people: Person[];
      };
    const mine = await view(owner);
    expect(mine.weekStarts).toHaveLength(4);
    const personA = mine.people.find((p) => p.userId === a.id);
    expect(personA).toMatchObject({
      overdue: 1,
      later: 1,
      noDueDate: 1,
      total: 5,
    });
    expect(personA?.weeks.reduce((n, w) => n + w, 0)).toBe(2);
    expect(mine.people.find((p) => p.userId === b.id)?.total).toBe(1);

    // The viewer cannot open SECRET, so B's work there is not counted.
    const theirs = await view(viewer);
    expect(theirs.people.some((p) => p.userId === b.id)).toBe(false);
    expect(theirs.people.find((p) => p.userId === a.id)?.total).toBe(5);

    const guest = await fx.join(slug, owner, 'guest');
    expect(
      (await fx.call(guest, 'GET', `/organizations/${slug}/workload`)).status,
    ).toBe(403);
    expect(
      (await fx.call(owner, 'GET', `/organizations/${slug}/workload?weeks=99`))
        .status,
    ).toBe(400);
  });
});
