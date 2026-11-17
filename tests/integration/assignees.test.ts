import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { notifyBatch } from '../../apps/worker/src/notifications/notifier';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
let pool: Pool;
beforeAll(async () => {
  fx = await startFixtures();
  pool = new Pool({
    connectionString: parseEnvironment(process.env).DATABASE_URL,
  });
});
afterAll(async () => {
  await pool.end();
  await fx.close();
});

interface TaskView {
  version: number;
  assignee: { userId: string } | null;
  assignees: { userId: string; displayName: string }[];
}

describe('multiple assignees', () => {
  it('keeps a primary assignee, filters by anyone and notifies people added', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const a = await fx.join(slug, owner, 'member');
    const b = await fx.join(slug, owner, 'member');
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'MA',
      name: 'Many',
    });
    const base = `/organizations/${slug}/projects/MA`;
    const org = await fx.db.query<{ id: string }>(
      'SELECT id FROM organizations WHERE slug = $1',
      [slug],
    );
    const organizationId = org.rows[0]?.id ?? '';
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Pair on the survey',
      assigneeId: a.id,
    });
    await notifyBatch(pool, { organizationId });

    const set = (userIds: string[]) =>
      fx.call(owner, 'PUT', `${base}/tasks/1/assignees`, { userIds });
    const both = (await set([a.id, b.id])).json as TaskView;
    expect(both.assignee?.userId).toBe(a.id);
    expect(both.assignees.map((x) => x.userId)).toEqual([a.id, b.id]);

    // Filtering by a second assignee finds the task.
    const filtered = (
      await fx.call(owner, 'GET', `${base}/tasks?assignee=${b.id}`)
    ).json as {
      tasks: unknown[];
    };
    expect(filtered.tasks).toHaveLength(1);
    expect(
      (
        (await fx.call(b, 'GET', `${base}/tasks?assignee=me`)).json as {
          tasks: unknown[];
        }
      ).tasks,
    ).toHaveLength(1);

    // Only the newly added person is notified.
    await notifyBatch(pool, { organizationId });
    const inbox = async (who: typeof a) =>
      (
        (await fx.call(who, 'GET', `/organizations/${slug}/notifications`))
          .json as { kind: string }[]
      ).length;
    expect(await inbox(a)).toBe(1);
    expect(await inbox(b)).toBe(1);

    // Dropping the primary promotes the next person.
    const onlyB = (await set([b.id])).json as TaskView;
    expect(onlyB.assignee?.userId).toBe(b.id);
    expect(onlyB.assignees.map((x) => x.userId)).toEqual([b.id]);

    // Setting the single assignee through PATCH replaces the primary.
    await set([b.id, a.id]);
    const current = (await fx.call(owner, 'GET', `${base}/tasks/1`))
      .json as TaskView;
    const patched = (
      await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
        version: current.version,
        assigneeId: owner.id,
      })
    ).json as TaskView;
    expect(patched.assignee?.userId).toBe(owner.id);
    expect(patched.assignees.map((x) => x.userId).sort()).toEqual(
      [owner.id, a.id].sort(),
    );

    // Clearing it unassigns everyone.
    const cleared = (
      await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
        version: patched.version,
        assigneeId: null,
      })
    ).json as TaskView;
    expect(cleared.assignees).toEqual([]);
    expect((await set([])).status).toBe(200);
  });

  it('refuses people who cannot open the project', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'MB',
      name: 'Closed',
      visibility: 'private',
    });
    await fx.call(owner, 'POST', `/organizations/${slug}/projects/MB/tasks`, {
      title: 'Secret',
    });
    const member = await fx.join(slug, owner, 'member');
    const stranger = await fx.account('stranger');
    for (const id of [member.id, stranger.id]) {
      expect(
        (
          await fx.call(
            owner,
            'PUT',
            `/organizations/${slug}/projects/MB/tasks/1/assignees`,
            { userIds: [id] },
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await fx.call(
          member,
          'PUT',
          `/organizations/${slug}/projects/MB/tasks/1/assignees`,
          { userIds: [] },
        )
      ).status,
    ).toBe(404);
  });
});
