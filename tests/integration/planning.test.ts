import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

async function setup(key = 'PLAN', tasks = 4) {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key,
    name: 'Plan',
  });
  const base = `/organizations/${slug}/projects/${key}`;
  for (let i = 1; i <= tasks; i += 1) {
    await fx.call(owner, 'POST', `${base}/tasks`, { title: `Step ${i}` });
  }
  return { owner, slug, base };
}

describe('dependencies', () => {
  it('records blockers both ways and refuses loops', async () => {
    const { owner, base } = await setup();
    const block = (task: number, blocker: number) =>
      fx.call(owner, 'POST', `${base}/tasks/${task}/dependencies`, {
        blockerNumber: blocker,
      });
    expect((await block(2, 1)).status).toBe(204);
    expect((await block(3, 2)).status).toBe(204);
    expect((await block(3, 2)).status).toBe(409);
    // 1 -> 2 -> 3, so 3 blocking 1 would be a loop; a task cannot block itself.
    expect((await block(1, 3)).status).toBe(400);
    expect((await block(1, 1)).status).toBe(400);
    expect((await block(1, 99)).status).toBe(400);

    const deps = (await fx.call(owner, 'GET', `${base}/tasks/2/dependencies`))
      .json as {
      blockedBy: { key: string; done: boolean }[];
      blocking: { key: string }[];
    };
    expect(deps.blockedBy).toEqual([
      expect.objectContaining({ key: 'PLAN-1', done: false }),
    ]);
    expect(deps.blocking.map((d) => d.key)).toEqual(['PLAN-3']);

    expect(
      (await fx.call(owner, 'DELETE', `${base}/tasks/2/dependencies/1`)).status,
    ).toBe(204);
    expect(
      (await fx.call(owner, 'DELETE', `${base}/tasks/2/dependencies/1`)).status,
    ).toBe(404);
    const actions = (
      (await fx.call(owner, 'GET', `${base}/tasks/2/activity`)).json as {
        action: string;
      }[]
    ).map((a) => a.action);
    expect(actions).toEqual([
      'task.created',
      'dependency.added',
      'dependency.removed',
    ]);
  });

  it('requires write access and stays inside the project', async () => {
    const { owner, slug, base } = await setup('DEPS', 2);
    const viewer = await fx.join(slug, owner, 'member');
    await fx.call(owner, 'PUT', `${base}/members/${viewer.id}`, {
      role: 'viewer',
    });
    expect(
      (
        await fx.call(viewer, 'POST', `${base}/tasks/2/dependencies`, {
          blockerNumber: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (await fx.call(viewer, 'GET', `${base}/tasks/2/dependencies`)).status,
    ).toBe(200);
    const other = await setup('ELSE', 1);
    expect(
      (await fx.call(other.owner, 'GET', `${base}/tasks/2/dependencies`))
        .status,
    ).toBe(404);
  });
});

describe('milestones', () => {
  it('groups tasks, reports progress and releases tasks when deleted', async () => {
    const { owner, base } = await setup('MILE', 3);
    const created = await fx.call(owner, 'POST', `${base}/milestones`, {
      title: 'Field season',
      dueAt: '2027-03-01T00:00:00Z',
    });
    expect(created.status).toBe(201);
    const id = (created.json as { id: string }).id;
    const states = (await fx.call(owner, 'GET', `${base}/states`)).json as {
      id: string;
      key: string;
    }[];
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      milestoneId: id,
    });
    await fx.call(owner, 'PATCH', `${base}/tasks/2`, {
      version: 1,
      milestoneId: id,
      stateId: states.find((s) => s.key === 'done')?.id,
    });
    const list = (await fx.call(owner, 'GET', `${base}/milestones`)).json as {
      title: string;
      taskCount: number;
      doneCount: number;
    }[];
    expect(list).toEqual([
      expect.objectContaining({
        title: 'Field season',
        taskCount: 2,
        doneCount: 1,
      }),
    ]);
    const inMilestone = (
      await fx.call(owner, 'GET', `${base}/tasks?milestone=${id}`)
    ).json as {
      tasks: { key: string; milestone: { title: string } | null }[];
    };
    expect(inMilestone.tasks.map((t) => t.key)).toEqual(['MILE-1', 'MILE-2']);
    expect(inMilestone.tasks[0]?.milestone?.title).toBe('Field season');

    const closed = await fx.call(owner, 'PATCH', `${base}/milestones/${id}`, {
      status: 'closed',
    });
    expect(closed.json).toMatchObject({ status: 'closed' });
    expect(
      (await fx.call(owner, 'DELETE', `${base}/milestones/${id}`)).status,
    ).toBe(204);
    const released = (await fx.call(owner, 'GET', `${base}/tasks/1`)).json as {
      milestone: unknown;
    };
    expect(released.milestone).toBeNull();
  });

  it("rejects another project's milestone and limits management to managers", async () => {
    const a = await setup('ONE', 1);
    const foreign = (
      await fx.call(a.owner, 'POST', `/organizations/${a.slug}/projects`, {
        key: 'TWO',
        name: 'Two',
      })
    ).json;
    expect(foreign).toBeTruthy();
    const other = (
      await fx.call(
        a.owner,
        'POST',
        `/organizations/${a.slug}/projects/TWO/milestones`,
        {
          title: 'Elsewhere',
        },
      )
    ).json as { id: string };
    expect(
      (
        await fx.call(a.owner, 'PATCH', `${a.base}/tasks/1`, {
          version: 1,
          milestoneId: other.id,
        })
      ).status,
    ).toBe(400);
    const member = await fx.join(a.slug, a.owner, 'member');
    expect(
      (await fx.call(member, 'POST', `${a.base}/milestones`, { title: 'Mine' }))
        .status,
    ).toBe(403);
  });
});
