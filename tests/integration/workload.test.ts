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

  it('totals estimates per week against capacity, shared between assignees', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const a = await fx.join(slug, owner, 'member');
    const b = await fx.join(slug, owner, 'member');
    const c = await fx.join(slug, owner, 'member');
    const base = `/organizations/${slug}/projects/CAP`;
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'CAP',
      name: 'Capacity',
    });
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Solo',
      assigneeId: a.id,
      dueAt: soon,
      estimateMinutes: 600,
    });
    const shared = await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Pair',
      assigneeId: a.id,
      dueAt: soon,
      estimateMinutes: 240,
    });
    expect(shared.json).toMatchObject({ estimateMinutes: 240 });
    expect(
      (
        await fx.call(owner, 'PUT', `${base}/tasks/2/assignees`, {
          userIds: [a.id, b.id],
        })
      ).status,
    ).toBe(200);

    const capacity = (
      who: typeof owner,
      id: string,
      weeklyMinutes: number | null,
    ) =>
      fx.call(who, 'PUT', `/organizations/${slug}/workload/capacity/${id}`, {
        weeklyMinutes,
      });
    expect((await capacity(a, a.id, 480)).status).toBe(200);
    expect((await capacity(owner, c.id, 1200)).status).toBe(200);
    // Members set only their own; bad values and strangers are refused.
    expect((await capacity(a, b.id, 600)).status).toBe(403);
    expect((await capacity(a, a.id, 20000)).status).toBe(400);
    const stranger = await fx.account('stranger');
    await fx.organization(stranger);
    expect((await capacity(owner, stranger.id, 60)).status).toBe(404);

    const view = (
      await fx.call(owner, 'GET', `/organizations/${slug}/workload?weeks=3`)
    ).json as {
      weekStarts: string[];
      people: (Person & {
        weekMinutes: number[];
        capacityMinutes: number | null;
      })[];
    };
    const sum = (list: number[]) => list.reduce((n, x) => n + x, 0);
    const personA = view.people.find((p) => p.userId === a.id);
    expect(personA?.capacityMinutes).toBe(480);
    expect(sum(personA?.weekMinutes ?? [])).toBe(720);
    expect(
      sum(view.people.find((p) => p.userId === b.id)?.weekMinutes ?? []),
    ).toBe(120);
    // Someone with a capacity and no work still appears.
    expect(view.people.find((p) => p.userId === c.id)).toMatchObject({
      capacityMinutes: 1200,
      total: 0,
    });
    expect(
      (
        await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
          version: 1,
          estimateMinutes: 0,
        })
      ).status,
    ).toBe(400);
  });
});
