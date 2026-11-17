import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { runAutomations } from '../../apps/worker/src/automations/engine';
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
    key: 'AUTO',
    name: 'Rules',
  });
  const base = `/organizations/${slug}/projects/AUTO`;
  const states = (await fx.call(owner, 'GET', `${base}/states`)).json as {
    id: string;
    key: string;
  }[];
  const state = (key: string) => states.find((s) => s.key === key)?.id ?? '';
  const label = (
    await fx.call(owner, 'POST', `/organizations/${slug}/labels`, {
      name: 'Escalated',
      color: 'rose',
    })
  ).json as { id: string };
  const org = await fx.db.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  const organizationId = org.rows[0]?.id ?? '';
  const run = () => runAutomations(pool, { organizationId });
  /** Runs until no unprocessed events remain, returning the totals. */
  const settle = async () => {
    const total = { applied: 0, skipped: 0, failed: 0 };
    for (let i = 0; i < 10; i += 1) {
      const r = await run();
      total.applied += r.applied;
      total.skipped += r.skipped;
      total.failed += r.failed;
      const left = await fx.db.query<{ count: string }>(
        'SELECT count(*) FROM outbox_events WHERE organization_id = $1 AND automations_at IS NULL',
        [organizationId],
      );
      if (left.rows[0]?.count === '0') break;
    }
    return total;
  };
  const rule = (body: Record<string, unknown>) =>
    fx.call(owner, 'POST', `${base}/automations`, body);
  const getTask = async (n: number) =>
    (await fx.call(owner, 'GET', `${base}/tasks/${n}`)).json as {
      priority: string;
      assignee: { userId: string } | null;
      labels: { id: string }[];
      state: { key: string };
    };
  return {
    owner,
    member,
    slug,
    base,
    state,
    label,
    organizationId,
    run,
    settle,
    rule,
    getTask,
  };
}

describe('automation rules', () => {
  it('applies matching rules once, as the person who made them', async () => {
    const { owner, member, base, label, settle, run, rule, getTask } =
      await setup();
    const created = await rule({
      name: 'Escalate urgent work',
      trigger: { type: 'task.created' },
      conditions: { priorities: ['urgent'] },
      actions: [
        { type: 'assign', userId: member.id },
        { type: 'add_label', labelId: label.id },
        { type: 'comment', body: 'Escalated automatically.' },
      ],
    });
    expect(created.status).toBe(201);
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Hull breach',
      priority: 'urgent',
    });
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Paint',
      priority: 'low',
    });
    expect((await settle()).applied).toBe(1);
    expect(await run()).toEqual({ applied: 0, skipped: 0, failed: 0 });

    const urgent = await getTask(1);
    expect(urgent.assignee?.userId).toBe(member.id);
    expect(urgent.labels.map((l) => l.id)).toEqual([label.id]);
    expect((await getTask(2)).assignee).toBeNull();
    const comments = (await fx.call(owner, 'GET', `${base}/tasks/1/comments`))
      .json as {
      body: string;
      author: { userId: string };
    }[];
    expect(comments[0]).toMatchObject({
      body: 'Escalated automatically.',
      author: { userId: owner.id },
    });
    const history = (await fx.call(owner, 'GET', `${base}/tasks/1/activity`))
      .json as {
      changes: Record<string, unknown>;
    }[];
    expect(
      history.some((h) => h.changes.automation === 'Escalate urgent work'),
    ).toBe(true);

    const runs = (
      await fx.call(
        owner,
        'GET',
        `${base}/automations/${(created.json as { id: string }).id}/runs`,
      )
    ).json as { status: string; task: string }[];
    expect(runs).toEqual([
      expect.objectContaining({ status: 'applied', task: 'AUTO-1' }),
    ]);
  });

  it('stops chains of rules that trigger each other', async () => {
    const { owner, base, state, organizationId, settle, rule, getTask } =
      await setup();
    await rule({
      name: 'Reopen finished work',
      trigger: { type: 'task.state_changed', toStateId: state('done') },
      actions: [{ type: 'set_state', stateId: state('in_progress') }],
    });
    await rule({
      name: 'Finish started work',
      trigger: { type: 'task.state_changed', toStateId: state('in_progress') },
      actions: [{ type: 'set_state', stateId: state('done') }],
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Ping pong' });
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      stateId: state('done'),
    });
    const totals = await settle();
    expect(totals.applied).toBe(3);
    expect(totals.skipped).toBe(1);
    const skipped = await fx.db.query<{ detail: string }>(
      `SELECT detail FROM automation_runs WHERE organization_id = $1 AND status = 'skipped'`,
      [organizationId],
    );
    expect(skipped.rows.map((r) => r.detail)).toContain('depth limit');
    expect(['done', 'in_progress']).toContain((await getTask(1)).state.key);
  });

  it('never reacts to its own change', async () => {
    const { owner, base, state, organizationId, settle, rule, getTask } =
      await setup();
    await rule({
      name: 'Back to work',
      trigger: { type: 'task.state_changed' },
      actions: [{ type: 'set_state', stateId: state('in_progress') }],
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Loop' });
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      stateId: state('done'),
    });
    expect(await settle()).toEqual({ applied: 1, skipped: 1, failed: 0 });
    const skipped = await fx.db.query<{ detail: string }>(
      `SELECT detail FROM automation_runs WHERE organization_id = $1 AND status = 'skipped'`,
      [organizationId],
    );
    expect(skipped.rows).toEqual([{ detail: 'own change' }]);
    expect((await getTask(1)).state.key).toBe('in_progress');
  });

  it('rolls back a rule whose action no longer applies', async () => {
    const { owner, member, slug, base, settle, rule, getTask } = await setup();
    await rule({
      name: 'Hand to member',
      trigger: { type: 'task.created' },
      actions: [
        { type: 'set_priority', priority: 'high' },
        { type: 'assign', userId: member.id },
      ],
    });
    await fx.call(
      owner,
      'DELETE',
      `/organizations/${slug}/members/${member.id}`,
    );
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Orphan' });
    expect((await settle()).failed).toBe(1);
    const task = await getTask(1);
    expect(task.priority).toBe('none');
    expect(task.assignee).toBeNull();
  });

  it('validates rules, limits them to managers, and simulates conditions', async () => {
    const { owner, member, base, rule } = await setup();
    const foreign = await (async () => {
      const other = await fx.account('other');
      const otherSlug = await fx.organization(other);
      return (
        await fx.call(other, 'POST', `/organizations/${otherSlug}/labels`, {
          name: 'Theirs',
          color: 'sea',
        })
      ).json as { id: string };
    })();
    expect(
      (
        await rule({
          name: 'Bad',
          trigger: { type: 'task.created' },
          actions: [{ type: 'add_label', labelId: foreign.id }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(member, 'POST', `${base}/automations`, {
          name: 'Mine',
          trigger: { type: 'task.created' },
          actions: [{ type: 'set_priority', priority: 'low' }],
        })
      ).status,
    ).toBe(403);
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Storm',
      priority: 'urgent',
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Calm' });
    const preview = (
      await fx.call(owner, 'POST', `${base}/automations/simulate`, {
        conditions: { priorities: ['urgent'] },
      })
    ).json as { matched: { key: string }[]; checked: number };
    expect(preview).toEqual({
      matched: [{ key: 'AUTO-1', title: 'Storm' }],
      checked: 2,
    });
  });

  it('ignores disabled rules', async () => {
    const { owner, base, settle, rule, getTask } = await setup();
    const { json } = await rule({
      name: 'Off',
      trigger: { type: 'task.created' },
      actions: [{ type: 'set_priority', priority: 'urgent' }],
      enabled: false,
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Quiet' });
    expect((await settle()).applied).toBe(0);
    expect((await getTask(1)).priority).toBe('none');
    expect(
      (
        await fx.call(
          owner,
          'PATCH',
          `${base}/automations/${(json as { id: string }).id}`,
          { enabled: true },
        )
      ).status,
    ).toBe(200);
  });
});
