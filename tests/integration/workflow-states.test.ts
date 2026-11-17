import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

interface State {
  id: string;
  key: string;
  label: string;
  category: string;
  position: number;
}

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'FLOW',
    name: 'Flow',
  });
  const base = `/organizations/${slug}/projects/FLOW`;
  const states = async () =>
    (await fx.call(owner, 'GET', `${base}/states`)).json as State[];
  return { owner, slug, base, states };
}

describe('workflow states', () => {
  it('adds, renames, recategorizes and reorders states', async () => {
    const { owner, base, states } = await setup();
    const review = await fx.call(owner, 'POST', `${base}/states`, {
      label: 'In review',
      category: 'in_progress',
    });
    expect(review.status).toBe(201);
    expect(review.json).toMatchObject({ key: 'in_review', position: 4 });
    const again = await fx.call(owner, 'POST', `${base}/states`, {
      label: 'In review',
      category: 'in_progress',
    });
    expect((again.json as State).key).toBe('in_review_2');

    const current = await states();
    const [todo, doing, done, inReview, second] = current;
    const order = [todo, doing, inReview, second, done].map((s) => s?.id);
    const reordered = await fx.call(owner, 'PUT', `${base}/states/order`, {
      stateIds: order,
    });
    expect(reordered.status).toBe(200);
    expect((await states()).map((s) => s.label)).toEqual([
      'To do',
      'In progress',
      'In review',
      'In review',
      'Done',
    ]);
    expect(
      (
        await fx.call(owner, 'PUT', `${base}/states/order`, {
          stateIds: order.slice(1),
        })
      ).status,
    ).toBe(400);

    const renamed = await fx.call(
      owner,
      'PATCH',
      `${base}/states/${second?.id}`,
      {
        label: 'QA',
      },
    );
    expect(renamed.json).toMatchObject({ label: 'QA', key: 'in_review_2' });
  });

  it('keeps completion consistent when a state changes category', async () => {
    const { owner, base, states } = await setup();
    const doing = (await states()).find((s) => s.key === 'in_progress');
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Ship',
      stateId: doing?.id,
    });
    await fx.call(owner, 'PATCH', `${base}/states/${doing?.id}`, {
      category: 'done',
    });
    const task = (await fx.call(owner, 'GET', `${base}/tasks/1`)).json as {
      completedAt: string | null;
    };
    expect(task.completedAt).not.toBeNull();
  });

  it('moves tasks out of a deleted state and refuses unsafe deletions', async () => {
    const { owner, base, states } = await setup();
    const [todo, doing, done] = await states();
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'A',
      stateId: doing?.id,
    });
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'B',
      stateId: doing?.id,
    });

    // Tasks exist, so a destination is required.
    expect(
      (await fx.call(owner, 'DELETE', `${base}/states/${doing?.id}`)).status,
    ).toBe(409);
    expect(
      (
        await fx.call(
          owner,
          'DELETE',
          `${base}/states/${doing?.id}?moveTo=${doing?.id}`,
        )
      ).status,
    ).toBe(400);
    const removed = await fx.call(
      owner,
      'DELETE',
      `${base}/states/${doing?.id}?moveTo=${done?.id}`,
    );
    expect(removed.status).toBe(204);
    const moved = (await fx.call(owner, 'GET', `${base}/tasks?state=done`))
      .json as {
      tasks: { version: number; completedAt: string | null }[];
    };
    expect(moved.tasks).toHaveLength(2);
    expect(
      moved.tasks.every((t) => t.version === 2 && t.completedAt !== null),
    ).toBe(true);
    const history = (await fx.call(owner, 'GET', `${base}/tasks/1/activity`))
      .json as {
      changes: Record<string, unknown>;
    }[];
    expect(history.at(-1)?.changes).toEqual({
      state: { from: 'in_progress', to: 'done' },
    });

    // An empty state can be deleted without a destination; the last cannot.
    expect(
      (await fx.call(owner, 'DELETE', `${base}/states/${todo?.id}`)).status,
    ).toBe(204);
    expect(
      (
        await fx.call(
          owner,
          'DELETE',
          `${base}/states/${done?.id}?moveTo=${done?.id}`,
        )
      ).status,
    ).toBe(400);
    const last = await states();
    expect(last).toHaveLength(1);
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 2,
      title: 'Still editable',
    });
    expect(
      (await fx.call(owner, 'DELETE', `${base}/states/${last[0]?.id}`)).status,
    ).toBe(409);
  });

  it('is limited to project managers', async () => {
    const { owner, slug, base, states } = await setup();
    const member = await fx.join(slug, owner, 'member');
    const [todo] = await states();
    expect(
      (
        await fx.call(member, 'POST', `${base}/states`, {
          label: 'X',
          category: 'todo',
        })
      ).status,
    ).toBe(403);
    expect(
      (await fx.call(member, 'DELETE', `${base}/states/${todo?.id}`)).status,
    ).toBe(403);
    expect((await fx.call(member, 'GET', `${base}/states`)).status).toBe(200);
  });
});
