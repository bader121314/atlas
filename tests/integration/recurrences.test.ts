import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { runRecurrences } from '../../apps/worker/src/recurrences/scheduler';
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

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  const member = await fx.join(slug, owner, 'member');
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'REC',
    name: 'Routines',
  });
  const org = await fx.db.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  const organizationId = org.rows[0]?.id ?? '';
  const base = `/organizations/${slug}/projects/REC`;
  return {
    owner,
    member,
    slug,
    base,
    run: () => runRecurrences(pool, { organizationId }),
  };
}

describe('recurring tasks', () => {
  it('creates one task per occurrence and moves to the next', async () => {
    const { owner, member, base, run } = await setup();
    const startsAt = new Date(Date.now() - 3600_000);
    const created = await fx.call(owner, 'POST', `${base}/recurrences`, {
      title: 'Check the tide gauge',
      frequency: 'weekly',
      assigneeId: member.id,
      priority: 'high',
      dueInDays: 2,
      startsAt: startsAt.toISOString(),
    });
    expect(created.status).toBe(201);
    expect(await run()).toEqual({ created: 1, disabled: 0 });
    expect(await run()).toEqual({ created: 0, disabled: 0 });

    const task = (await fx.call(owner, 'GET', `${base}/tasks/1`)).json as {
      title: string;
      priority: string;
      assignee: { userId: string } | null;
      dueAt: string;
    };
    expect(task).toMatchObject({
      title: 'Check the tide gauge',
      priority: 'high',
      assignee: { userId: member.id },
    });
    expect(new Date(task.dueAt).getTime()).toBe(
      startsAt.getTime() + 2 * 86_400_000,
    );
    const listed = (await fx.call(owner, 'GET', `${base}/recurrences`))
      .json as {
      nextRunAt: string;
      lastRunAt: string | null;
    }[];
    expect(new Date(listed[0]?.nextRunAt ?? '').getTime()).toBe(
      startsAt.getTime() + 7 * 86_400_000,
    );
    expect(listed[0]?.lastRunAt).not.toBeNull();
    const history = (await fx.call(owner, 'GET', `${base}/tasks/1/activity`))
      .json as {
      action: string;
      changes: Record<string, unknown>;
    }[];
    expect(history[0]).toMatchObject({
      action: 'task.created',
      changes: { recurrence: 'Check the tide gauge' },
    });
  });

  it('turns itself off when its creator can no longer edit the project', async () => {
    const { owner, member, slug, base, run } = await setup();
    await fx.call(member, 'POST', `${base}/recurrences`, {
      title: 'Mine',
      frequency: 'daily',
    });
    await fx.call(owner, 'PATCH', `/organizations/${slug}/projects/REC`, {
      version: 1,
      visibility: 'private',
    });
    expect(await run()).toEqual({ created: 0, disabled: 1 });
    const listed = (await fx.call(owner, 'GET', `${base}/recurrences`))
      .json as { enabled: boolean }[];
    expect(listed[0]?.enabled).toBe(false);
  });

  it('checks permissions and the assignee', async () => {
    const { owner, slug, base } = await setup();
    const guest = await fx.join(slug, owner, 'guest');
    const stranger = await fx.account('stranger');
    expect(
      (
        await fx.call(guest, 'POST', `${base}/recurrences`, {
          title: 'x',
          frequency: 'daily',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fx.call(owner, 'POST', `${base}/recurrences`, {
          title: 'x',
          frequency: 'daily',
          assigneeId: stranger.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(owner, 'POST', `${base}/recurrences`, {
          title: 'x',
          frequency: 'yearly',
        })
      ).status,
    ).toBe(400);
  });
});
