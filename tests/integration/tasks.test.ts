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

interface TaskBody {
  key: string;
  number: number;
  version: number;
  title: string;
  state: { id: string; key: string; category: string };
  assignee: { userId: string } | null;
  completedAt: string | null;
  dueAt: string | null;
}

async function setup(key = 'WORK') {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  const created = await fx.call(
    owner,
    'POST',
    `/organizations/${slug}/projects`,
    {
      key,
      name: 'Work',
    },
  );
  expect(created.status).toBe(201);
  const base = `/organizations/${slug}/projects/${key}`;
  const states = (await fx.call(owner, 'GET', `${base}/states`)).json as {
    id: string;
    key: string;
  }[];
  const state = (k: string) => states.find((s) => s.key === k)?.id ?? '';
  return { owner, slug, base, state };
}

function task(json: unknown): TaskBody {
  return json as TaskBody;
}

describe('tasks', () => {
  it('numbers tasks per project and starts them in the first state', async () => {
    const { owner, base } = await setup();
    const first = await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Survey the site',
    });
    const second = await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Draw the map',
    });
    expect(first.status).toBe(201);
    expect(task(first.json)).toMatchObject({
      key: 'WORK-1',
      number: 1,
      version: 1,
      state: { key: 'todo' },
      assignee: null,
    });
    expect(task(second.json).key).toBe('WORK-2');
    expect((await fx.call(owner, 'GET', `${base}/tasks/2`)).json).toMatchObject(
      {
        title: 'Draw the map',
      },
    );
    expect((await fx.call(owner, 'GET', `${base}/tasks/99`)).status).toBe(404);
    expect((await fx.call(owner, 'GET', `${base}/tasks/abc`)).status).toBe(404);
  });

  it('tracks completion and rejects stale versions', async () => {
    const { owner, base, state } = await setup();
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Finish it' });
    const done = await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      stateId: state('done'),
      priority: 'high',
    });
    expect(done.status).toBe(200);
    expect(task(done.json).completedAt).not.toBeNull();
    expect(task(done.json).version).toBe(2);
    const stale = await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      title: 'Overwrite',
    });
    expect(stale.status).toBe(409);
    const reopened = await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 2,
      stateId: state('in_progress'),
    });
    expect(task(reopened.json)).toMatchObject({
      completedAt: null,
      title: 'Finish it',
      state: { key: 'in_progress' },
    });
  });

  it('assigns only people who can see the project, and clears with null', async () => {
    const { owner, slug, base } = await setup();
    const member = await fx.join(slug, owner, 'member');
    const guest = await fx.join(slug, owner, 'guest');
    const created = await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Assigned',
      assigneeId: member.id,
      dueAt: '2026-12-01T09:00:00+03:00',
    });
    expect(task(created.json).assignee?.userId).toBe(member.id);
    expect(task(created.json).dueAt).toBe('2026-12-01T06:00:00.000Z');
    // The guest has no project role, so cannot be assigned.
    expect(
      (
        await fx.call(owner, 'POST', `${base}/tasks`, {
          title: 'X',
          assigneeId: guest.id,
        })
      ).status,
    ).toBe(400);
    const cleared = await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      assigneeId: null,
      dueAt: null,
    });
    expect(task(cleared.json)).toMatchObject({ assignee: null, dueAt: null });
  });

  it('filters and paginates with a stable cursor', async () => {
    const { owner, slug, base, state } = await setup();
    const member = await fx.join(slug, owner, 'member');
    for (let i = 1; i <= 5; i += 1) {
      await fx.call(owner, 'POST', `${base}/tasks`, {
        title: `Task ${i}`,
        assigneeId: i % 2 ? member.id : null,
        stateId: i === 5 ? state('done') : undefined,
      });
    }
    const page1 = (await fx.call(owner, 'GET', `${base}/tasks?limit=2`))
      .json as {
      tasks: TaskBody[];
      nextCursor: number | null;
    };
    expect(page1.tasks.map((t) => t.number)).toEqual([1, 2]);
    expect(page1.nextCursor).toBe(2);
    const page3 = (await fx.call(owner, 'GET', `${base}/tasks?limit=2&after=4`))
      .json as {
      tasks: TaskBody[];
      nextCursor: number | null;
    };
    expect(page3.tasks.map((t) => t.number)).toEqual([5]);
    expect(page3.nextCursor).toBeNull();

    const mine = (await fx.call(member, 'GET', `${base}/tasks?assignee=me`))
      .json as {
      tasks: TaskBody[];
    };
    expect(mine.tasks.map((t) => t.number)).toEqual([1, 3, 5]);
    const unassigned = (
      await fx.call(owner, 'GET', `${base}/tasks?assignee=none`)
    ).json as { tasks: TaskBody[] };
    expect(unassigned.tasks.map((t) => t.number)).toEqual([2, 4]);
    const done = (await fx.call(owner, 'GET', `${base}/tasks?state=done`))
      .json as {
      tasks: TaskBody[];
    };
    expect(done.tasks.map((t) => t.number)).toEqual([5]);
    expect(
      (await fx.call(owner, 'GET', `${base}/tasks?limit=500`)).status,
    ).toBe(400);
    expect(
      (await fx.call(owner, 'GET', `${base}/tasks?sort=evil`)).status,
    ).toBe(400);
  });

  it('enforces project roles and archived projects', async () => {
    const { owner, slug, base } = await setup();
    const viewer = await fx.join(slug, owner, 'member');
    await fx.call(owner, 'PUT', `${base}/members/${viewer.id}`, {
      role: 'viewer',
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Read only' });
    expect((await fx.call(viewer, 'GET', `${base}/tasks/1`)).status).toBe(200);
    expect(
      (await fx.call(viewer, 'POST', `${base}/tasks`, { title: 'No' })).status,
    ).toBe(403);
    expect(
      (
        await fx.call(viewer, 'PATCH', `${base}/tasks/1`, {
          version: 1,
          title: 'No',
        })
      ).status,
    ).toBe(403);

    await fx.call(owner, 'PATCH', base, { version: 1, status: 'archived' });
    expect(
      (await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Late' })).status,
    ).toBe(409);
    expect(
      (
        await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
          version: 1,
          title: 'Late',
        })
      ).status,
    ).toBe(409);
    expect((await fx.call(owner, 'GET', `${base}/tasks/1`)).status).toBe(200);
  });

  it('keeps tasks and states inside their own project and organization', async () => {
    const a = await setup('ALPHA');
    const b = await setup('BRAVO');
    await fx.call(a.owner, 'POST', `${a.base}/tasks`, { title: 'Mine' });
    // A state from another project cannot be used.
    expect(
      (
        await fx.call(a.owner, 'PATCH', `${a.base}/tasks/1`, {
          version: 1,
          stateId: b.state('done'),
        })
      ).status,
    ).toBe(400);
    // Another organization's owner cannot reach the task at all.
    const outsider: Account = b.owner;
    expect((await fx.call(outsider, 'GET', `${a.base}/tasks/1`)).status).toBe(
      404,
    );
    expect(
      (
        await fx.call(outsider, 'PATCH', `${a.base}/tasks/1`, {
          version: 1,
          title: 'X',
        })
      ).status,
    ).toBe(404);
  });

  it('keeps start dates on or before due dates and records them', async () => {
    const { owner, base } = await setup('PLAN');
    const created = await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Lay the keel',
      startAt: '2026-12-01T12:00:00Z',
      dueAt: '2026-12-10T12:00:00Z',
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      startAt: '2026-12-01T12:00:00.000Z',
      dueAt: '2026-12-10T12:00:00.000Z',
    });
    // Starting after the due date is refused, either way round.
    expect(
      (
        await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
          version: 1,
          startAt: '2026-12-11T12:00:00Z',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
          version: 1,
          dueAt: '2026-11-30T12:00:00Z',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(owner, 'POST', `${base}/tasks`, {
          title: 'Backwards',
          startAt: '2026-12-11T12:00:00Z',
          dueAt: '2026-12-10T12:00:00Z',
        })
      ).status,
    ).toBe(400);
    const moved = await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      startAt: '2026-12-03T12:00:00Z',
    });
    expect(moved.status).toBe(200);
    const history = (await fx.call(owner, 'GET', `${base}/tasks/1/activity`))
      .json as { action: string; changes: Record<string, unknown> }[];
    expect(history.some((h) => 'startAt' in h.changes)).toBe(true);
    // Clearing the due date leaves a start-only task.
    const cleared = await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 2,
      dueAt: null,
    });
    expect(task(cleared.json).dueAt).toBeNull();
  });
});
