import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'LOG',
    name: 'Log',
  });
  const base = `/organizations/${slug}/projects/LOG`;
  const created = await fx.call(owner, 'POST', `${base}/tasks`, {
    title: 'Chart the coast',
    description: 'private notes',
  });
  const taskId = (created.json as { id: string }).id;
  return { owner, slug, base, taskId };
}

async function outboxCount(taskId: string): Promise<number> {
  const result = await fx.db.query<{ count: string }>(
    'SELECT count(*) FROM outbox_events WHERE aggregate_id = $1',
    [taskId],
  );
  return Number(result.rows[0]?.count);
}

describe('activity and outbox', () => {
  it('records every task change with its outbox event, summarizing fields only', async () => {
    const { owner, base, taskId } = await setup();
    const states = (await fx.call(owner, 'GET', `${base}/states`)).json as {
      id: string;
      key: string;
    }[];
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      stateId: states.find((s) => s.key === 'in_progress')?.id,
      priority: 'urgent',
      description: 'secret plan',
    });
    const activity = (await fx.call(owner, 'GET', `${base}/tasks/1/activity`))
      .json as {
      action: string;
      changes: Record<string, unknown>;
    }[];
    expect(activity.map((a) => a.action)).toEqual([
      'task.created',
      'task.updated',
    ]);
    expect(activity[1]?.changes).toEqual({
      state: { from: 'todo', to: 'in_progress' },
      priority: { from: 'none', to: 'urgent' },
      description: true,
    });
    expect(JSON.stringify(activity)).not.toContain('secret plan');

    const outbox = await fx.db.query<{
      event_type: string;
      aggregate_version: string;
    }>(
      `SELECT event_type, aggregate_version FROM outbox_events
       WHERE aggregate_id = $1 ORDER BY occurred_at, aggregate_version`,
      [taskId],
    );
    expect(
      outbox.rows.map((r) => [r.event_type, Number(r.aggregate_version)]),
    ).toEqual([
      ['task.created', 1],
      ['task.updated', 2],
    ]);
  });

  it('writes nothing when the change is rejected', async () => {
    const { owner, base, taskId } = await setup();
    const before = await outboxCount(taskId);
    const stale = await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 7,
      title: 'Stale',
    });
    expect(stale.status).toBe(409);
    const badState = await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      stateId: '00000000-0000-4000-8000-000000000000',
    });
    expect(badState.status).toBe(400);
    expect(await outboxCount(taskId)).toBe(before);
  });
});

describe('comments', () => {
  it('lets commenters discuss, authors edit, and authors or managers delete', async () => {
    const { owner, slug, base } = await setup();
    const commenter = await fx.join(slug, owner, 'member');
    const viewer = await fx.join(slug, owner, 'member');
    await fx.call(owner, 'PUT', `${base}/members/${commenter.id}`, {
      role: 'commenter',
    });
    await fx.call(owner, 'PUT', `${base}/members/${viewer.id}`, {
      role: 'viewer',
    });

    const posted = await fx.call(
      commenter,
      'POST',
      `${base}/tasks/1/comments`,
      {
        body: 'Coastline survey booked for Tuesday.',
      },
    );
    expect(posted.status).toBe(201);
    const commentId = (posted.json as { id: string }).id;
    // Commenters can talk but not change the task; viewers can only read.
    expect(
      (
        await fx.call(commenter, 'PATCH', `${base}/tasks/1`, {
          version: 1,
          title: 'X',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fx.call(viewer, 'POST', `${base}/tasks/1/comments`, {
          body: 'Hi',
        })
      ).status,
    ).toBe(403);
    expect(
      (await fx.call(viewer, 'GET', `${base}/tasks/1/comments`)).status,
    ).toBe(200);

    // Only the author edits.
    expect(
      (
        await fx.call(owner, 'PATCH', `${base}/tasks/1/comments/${commentId}`, {
          body: 'Rewritten by someone else',
        })
      ).status,
    ).toBe(403);
    const edited = await fx.call(
      commenter,
      'PATCH',
      `${base}/tasks/1/comments/${commentId}`,
      { body: 'Coastline survey moved to Wednesday.' },
    );
    expect(edited.json).toMatchObject({
      body: 'Coastline survey moved to Wednesday.',
      deleted: false,
    });
    expect(
      (edited.json as { editedAt: string | null }).editedAt,
    ).not.toBeNull();

    // The manager (owner) may delete; the text is gone, the entry remains.
    const deleted = await fx.call(
      owner,
      'DELETE',
      `${base}/tasks/1/comments/${commentId}`,
    );
    expect(deleted.status).toBe(200);
    const thread = (await fx.call(viewer, 'GET', `${base}/tasks/1/comments`))
      .json as {
      body: string | null;
      deleted: boolean;
    }[];
    expect(thread).toEqual([
      expect.objectContaining({ body: null, deleted: true }),
    ]);
    expect(
      (await fx.call(owner, 'DELETE', `${base}/tasks/1/comments/${commentId}`))
        .status,
    ).toBe(404);

    const actions = (
      (await fx.call(owner, 'GET', `${base}/tasks/1/activity`)).json as {
        action: string;
      }[]
    ).map((a) => a.action);
    expect(actions).toEqual([
      'task.created',
      'comment.created',
      'comment.edited',
      'comment.deleted',
    ]);
  });

  it('cannot reach comments across projects or organizations', async () => {
    const a = await setup();
    const b = await setup();
    const posted = await fx.call(
      a.owner,
      'POST',
      `${a.base}/tasks/1/comments`,
      {
        body: 'Only for A',
      },
    );
    const id = (posted.json as { id: string }).id;
    // B's owner addresses A's comment through B's own project: not found.
    expect(
      (await fx.call(b.owner, 'DELETE', `${b.base}/tasks/1/comments/${id}`))
        .status,
    ).toBe(404);
    expect(
      (await fx.call(b.owner, 'GET', `${a.base}/tasks/1/comments`)).status,
    ).toBe(404);
  });
});
