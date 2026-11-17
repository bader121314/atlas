import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { emailBatch } from '../../apps/worker/src/notifications/email';
import type { MailMessage } from '../../apps/worker/src/notifications/email';
import { notifyBatch } from '../../apps/worker/src/notifications/notifier';
import { startFixtures } from './support/fixtures';
import type { Account } from './support/fixtures';

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

interface Item {
  id: string;
  kind: string;
  actor: string | null;
  task: { key: string; title: string };
  readAt: string | null;
}

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  const member = await fx.join(slug, owner, 'member');
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'NOT',
    name: 'Notify',
  });
  const base = `/organizations/${slug}/projects/NOT`;
  await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Survey the bay' });
  const org = await fx.db.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  const organizationId = org.rows[0]?.id ?? '';
  const notify = () => notifyBatch(pool, { organizationId });
  const inbox = async (who: Account, unread = false) =>
    (
      await fx.call(
        who,
        'GET',
        `/organizations/${slug}/notifications${unread ? '?unread=true' : ''}`,
      )
    ).json as Item[];
  const count = async (who: Account) =>
    (
      (
        await fx.call(
          who,
          'GET',
          `/organizations/${slug}/notifications/unread-count`,
        )
      ).json as {
        count: number;
      }
    ).count;
  return { owner, member, slug, base, organizationId, notify, inbox, count };
}

describe('notifications', () => {
  it('tells an assignee once, and never the person who acted', async () => {
    const { owner, member, base, notify, inbox, count } = await setup();
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      assigneeId: member.id,
    });
    expect(await notify()).toBe(1);
    expect(await notify()).toBe(0);
    const items = await inbox(member);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'task.assigned',
      task: { key: 'NOT-1', title: 'Survey the bay' },
      readAt: null,
    });
    expect(items[0]?.actor).toBeTruthy();
    expect(await count(member)).toBe(1);
    expect(await inbox(owner)).toEqual([]);
  });

  it('tells the reporter, assignee and earlier commenters about comments', async () => {
    const { owner, member, slug, base, notify, inbox } = await setup();
    const third = await fx.join(slug, owner, 'member');
    await fx.call(third, 'POST', `${base}/tasks/1/comments`, {
      body: 'Tide is low at six.',
    });
    await notify();
    expect((await inbox(owner)).map((i) => i.kind)).toEqual([
      'comment.created',
    ]);
    expect(await inbox(member)).toEqual([]);
    expect(await inbox(third)).toEqual([]);
    await fx.call(member, 'POST', `${base}/tasks/1/comments`, {
      body: 'I can go.',
    });
    await notify();
    expect((await inbox(third)).map((i) => i.kind)).toEqual([
      'comment.created',
    ]);
    expect(await inbox(owner)).toHaveLength(2);
    // Comment bodies are never part of a notification.
    expect(JSON.stringify(await inbox(owner))).not.toContain('I can go');
  });

  it('marks only your own notifications read', async () => {
    const { owner, member, slug, base, notify, inbox, count } = await setup();
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      assigneeId: member.id,
    });
    await fx.call(member, 'POST', `${base}/tasks/1/comments`, {
      body: 'On it.',
    });
    await notify();
    const theirs = (await inbox(member))[0]?.id ?? '';
    const mine = (await inbox(owner))[0]?.id ?? '';
    expect(
      (
        await fx.call(
          owner,
          'POST',
          `/organizations/${slug}/notifications/read`,
          { ids: [theirs, mine] },
        )
      ).status,
    ).toBe(204);
    expect(await count(member)).toBe(1);
    expect(await count(owner)).toBe(0);
    await fx.call(member, 'POST', `/organizations/${slug}/notifications/read`, {
      all: true,
    });
    expect(await count(member)).toBe(0);
    expect(await inbox(member, true)).toEqual([]);
    expect(
      (
        await fx.call(
          member,
          'POST',
          `/organizations/${slug}/notifications/read`,
          { ids: [] },
        )
      ).status,
    ).toBe(400);
  });

  it('hides notifications about projects you can no longer read', async () => {
    const { owner, member, slug, base, notify, inbox } = await setup();
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      assigneeId: member.id,
    });
    await notify();
    expect(await inbox(member)).toHaveLength(1);
    await fx.call(owner, 'PATCH', `/organizations/${slug}/projects/NOT`, {
      version: 1,
      visibility: 'private',
    });
    expect(await inbox(member)).toEqual([]);
    const outsider = await fx.account('outsider');
    expect(
      (await fx.call(outsider, 'GET', `/organizations/${slug}/notifications`))
        .status,
    ).toBe(404);
  });

  it('emails unread notifications, respecting the email setting', async () => {
    const { owner, member, slug, base, organizationId, notify } = await setup();
    const sent: MailMessage[] = [];
    const send = async (message: MailMessage) => {
      sent.push(message);
    };
    const run = (delayMs = 0) =>
      emailBatch(pool, send, {
        delayMs,
        webOrigin: 'https://atlas.test',
        organizationId,
      });

    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      assigneeId: member.id,
    });
    await notify();
    expect(await run(60_000)).toEqual({ sent: 0, skipped: 0 });
    expect(await run()).toEqual({ sent: 1, skipped: 0 });
    expect(sent[0]).toMatchObject({
      to: member.email,
      subject: 'NOT-1 was assigned to you: Survey the bay',
    });
    expect(sent[0]?.text).toContain(
      `https://atlas.test/organizations/${slug}/projects/NOT/tasks/1`,
    );
    expect(await run()).toEqual({ sent: 0, skipped: 0 });

    // Turned off: the owner's comment notification is skipped.
    expect(
      (
        await fx.call(
          member,
          'GET',
          `/organizations/${slug}/notification-settings`,
        )
      ).json,
    ).toEqual({ email: true });
    await fx.call(
      member,
      'PUT',
      `/organizations/${slug}/notification-settings`,
      { email: false },
    );
    await fx.call(member, 'POST', `${base}/tasks/1/comments`, {
      body: 'Hello',
    });
    await fx.call(owner, 'POST', `${base}/tasks/1/comments`, {
      body: 'Thanks',
    });
    await notify();
    expect(await run()).toEqual({ sent: 1, skipped: 1 });
    expect(sent[1]?.to).toBe(owner.email);
  });
});
