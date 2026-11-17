import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

interface TaskBody {
  key: string;
  version: number;
  parent: { number: number; key: string } | null;
  labels: { id: string; name: string }[];
  assignee: { userId: string } | null;
}

async function setup(key = 'MAP') {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key,
    name: 'Map',
  });
  return { owner, slug, base: `/organizations/${slug}/projects/${key}` };
}

describe('labels', () => {
  it('creates organization labels and applies them to tasks', async () => {
    const { owner, slug, base } = await setup();
    const member = await fx.join(slug, owner, 'member');
    const guest = await fx.join(slug, owner, 'guest');
    const labels = `/organizations/${slug}/labels`;
    const field = await fx.call(member, 'POST', labels, {
      name: 'Field work',
      color: 'sage',
    });
    expect(field.status).toBe(201);
    const fieldId = (field.json as { id: string }).id;
    expect(
      (await fx.call(owner, 'POST', labels, { name: 'field WORK' })).status,
    ).toBe(409);
    expect(
      (await fx.call(guest, 'POST', labels, { name: 'Nope' })).status,
    ).toBe(403);
    const urgent = (
      await fx.call(owner, 'POST', labels, { name: 'Blocked', color: 'rose' })
    ).json as { id: string };

    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Walk the boundary',
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Write it up' });
    const labelled = await fx.call(owner, 'PUT', `${base}/tasks/1/labels`, {
      labelIds: [fieldId, urgent.id, fieldId],
    });
    expect(labelled.status).toBe(200);
    expect((labelled.json as TaskBody).labels.map((l) => l.name)).toEqual([
      'Blocked',
      'Field work',
    ]);
    expect((labelled.json as TaskBody).version).toBe(2);

    const filtered = (
      await fx.call(owner, 'GET', `${base}/tasks?label=${fieldId}`)
    ).json as {
      tasks: TaskBody[];
    };
    expect(filtered.tasks.map((t) => t.key)).toEqual(['MAP-1']);

    // Deleting a label is owner/admin only and removes it from tasks.
    expect(
      (await fx.call(member, 'DELETE', `${labels}/${urgent.id}`)).status,
    ).toBe(403);
    expect(
      (await fx.call(owner, 'DELETE', `${labels}/${urgent.id}`)).status,
    ).toBe(204);
    const after = (await fx.call(owner, 'GET', `${base}/tasks/1`))
      .json as TaskBody;
    expect(after.labels.map((l) => l.name)).toEqual(['Field work']);
  });

  it("rejects another organization's labels", async () => {
    const a = await setup('AAA');
    const b = await setup('BBB');
    const foreign = (
      await fx.call(b.owner, 'POST', `/organizations/${b.slug}/labels`, {
        name: 'Theirs',
      })
    ).json as { id: string };
    await fx.call(a.owner, 'POST', `${a.base}/tasks`, { title: 'Mine' });
    expect(
      (
        await fx.call(a.owner, 'PUT', `${a.base}/tasks/1/labels`, {
          labelIds: [foreign.id],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(
          a.owner,
          'DELETE',
          `/organizations/${a.slug}/labels/${foreign.id}`,
        )
      ).status,
    ).toBe(404);
  });
});

describe('subtasks', () => {
  it('nests tasks, filters by parent, and blocks loops and other projects', async () => {
    const { owner, slug, base } = await setup();
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Survey' });
    const child = await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'North shore',
      parentNumber: 1,
    });
    expect((child.json as TaskBody).parent).toEqual({
      number: 1,
      key: 'MAP-1',
    });
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Cove',
      parentNumber: 2,
    });

    const children = (await fx.call(owner, 'GET', `${base}/tasks?parent=1`))
      .json as {
      tasks: TaskBody[];
    };
    expect(children.tasks.map((t) => t.key)).toEqual(['MAP-2']);
    const roots = (await fx.call(owner, 'GET', `${base}/tasks?parent=none`))
      .json as {
      tasks: TaskBody[];
    };
    expect(roots.tasks.map((t) => t.key)).toEqual(['MAP-1']);

    // MAP-1 under its own grandchild would be a loop; under itself too.
    expect(
      (
        await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
          version: 1,
          parentNumber: 3,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
          version: 1,
          parentNumber: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(owner, 'POST', `${base}/tasks`, {
          title: 'X',
          parentNumber: 99,
        })
      ).status,
    ).toBe(400);

    // A task from another project cannot be a parent.
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'OTHER',
      name: 'O',
    });
    await fx.call(
      owner,
      'POST',
      `/organizations/${slug}/projects/OTHER/tasks`,
      {
        title: 'Elsewhere',
      },
    );
    const moved = await fx.call(owner, 'PATCH', `${base}/tasks/3`, {
      version: 1,
      parentNumber: null,
    });
    expect((moved.json as TaskBody).parent).toBeNull();
  });
});

describe('collaboration in one project (M2 exit)', () => {
  it('lets two signed-in users create, assign, update and comment', async () => {
    const { owner, slug, base } = await setup('TEAM');
    const teammate = await fx.join(slug, owner, 'member');

    const ownerTask = await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Plan the route',
      assigneeId: teammate.id,
    });
    const mateTask = await fx.call(teammate, 'POST', `${base}/tasks`, {
      title: 'Book the boat',
      assigneeId: owner.id,
    });
    expect(ownerTask.status).toBe(201);
    expect(mateTask.status).toBe(201);
    expect((mateTask.json as TaskBody).assignee?.userId).toBe(owner.id);

    const updated = await fx.call(teammate, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      priority: 'high',
    });
    expect(updated.status).toBe(200);
    expect(
      (
        await fx.call(owner, 'POST', `${base}/tasks/1/comments`, {
          body: 'Thanks!',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await fx.call(teammate, 'POST', `${base}/tasks/2/comments`, {
          body: 'Booked.',
        })
      ).status,
    ).toBe(201);

    const history = (await fx.call(owner, 'GET', `${base}/tasks/1/activity`))
      .json as {
      action: string;
      actor: { userId: string };
    }[];
    expect(history.map((h) => [h.action, h.actor.userId])).toEqual([
      ['task.created', owner.id],
      ['task.updated', teammate.id],
      ['comment.created', owner.id],
    ]);
  });
});
