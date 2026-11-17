import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

interface Analytics {
  total: number;
  done: number;
  overdue: number;
  unassigned: number;
  byState: { label: string; category: string; count: number }[];
  weeks: { weekStart: string; created: number; completed: number }[];
  medianLeadDays: number | null;
  openByAssignee: { userId: string; open: number }[];
}

describe('project analytics', () => {
  it('reports numbers that reconcile with the tasks in the database', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const member = await fx.join(slug, owner, 'member');
    const base = `/organizations/${slug}/projects/ANA`;
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'ANA',
      name: 'Numbers',
    });
    const states = (await fx.call(owner, 'GET', `${base}/states`)).json as {
      id: string;
      category: string;
    }[];
    const done = states.find((s) => s.category === 'done')?.id;
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const create = (body: Record<string, unknown>) =>
      fx.call(owner, 'POST', `${base}/tasks`, body);
    await create({ title: 'Late', dueAt: yesterday, assigneeId: member.id });
    await create({ title: 'Open', assigneeId: member.id });
    await create({ title: 'Loose' });
    await create({ title: 'Finished A' });
    await create({ title: 'Finished B', dueAt: yesterday });
    for (const number of [4, 5]) {
      await fx.call(owner, 'PATCH', `${base}/tasks/${number}`, {
        version: 1,
        stateId: done,
      });
    }
    // Lead times of two and four days.
    await fx.db.query(
      `UPDATE tasks t SET created_at = t.completed_at - (CASE t.number WHEN 4 THEN 2 ELSE 4 END) * interval '1 day'
       FROM projects p WHERE p.id = t.project_id AND p.key = 'ANA' AND t.number IN (4, 5)
         AND t.organization_id = (SELECT id FROM organizations WHERE slug = $1)`,
      [slug],
    );

    const response = await fx.call(member, 'GET', `${base}/analytics`);
    expect(response.status).toBe(200);
    const numbers = response.json as Analytics;
    expect(numbers).toMatchObject({
      total: 5,
      done: 2,
      overdue: 1,
      unassigned: 1,
      medianLeadDays: 3,
    });
    expect(numbers.byState.reduce((n, s) => n + s.count, 0)).toBe(
      numbers.total,
    );
    expect(numbers.byState.find((s) => s.category === 'done')?.count).toBe(2);
    expect(numbers.openByAssignee).toEqual([
      { userId: member.id, displayName: expect.any(String), open: 2 },
    ]);
    expect(numbers.weeks).toHaveLength(8);
    const thisWeek = numbers.weeks.at(-1);
    expect(thisWeek?.completed).toBe(2);
    // Every created task is counted in exactly one week, or before the window.
    const raw = await fx.db.query<{ count: string }>(
      `SELECT count(*) FROM tasks t JOIN projects p ON p.id = t.project_id
       JOIN organizations o ON o.id = t.organization_id
       WHERE o.slug = $1 AND p.key = 'ANA' AND t.created_at >= $2::date`,
      [slug, numbers.weeks[0]?.weekStart],
    );
    expect(numbers.weeks.reduce((n, w) => n + w.created, 0)).toBe(
      Number(raw.rows[0]?.count),
    );

    const outsider = await fx.account('outsider');
    expect((await fx.call(outsider, 'GET', `${base}/analytics`)).status).toBe(
      404,
    );
  });
});
