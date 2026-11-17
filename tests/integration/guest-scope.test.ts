import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { notifyBatch } from '../../apps/worker/src/notifications/notifier';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
const pool = new Pool({
  connectionString: parseEnvironment(process.env).DATABASE_URL,
  max: 2,
});
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
  await pool.end();
});

describe('label-scoped guests', () => {
  it('see, search, discuss and hear about only the tasks carrying their labels', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const guest = await fx.join(slug, owner, 'guest');
    const member = await fx.join(slug, owner, 'member');
    const org = `/organizations/${slug}`;
    const base = `${org}/projects/CLIENT`;
    await fx.call(owner, 'POST', `${org}/projects`, {
      key: 'CLIENT',
      name: 'Client work',
      visibility: 'private',
    });
    const label = async (name: string) =>
      (
        (await fx.call(owner, 'POST', `${org}/labels`, { name })).json as {
          id: string;
        }
      ).id;
    const shared = await label('Shared');
    const internal = await label('Internal');
    const milestone = (
      (await fx.call(owner, 'POST', `${base}/milestones`, { title: 'Phase 1' }))
        .json as {
        id: string;
      }
    ).id;
    const task = async (title: string, labelIds: string[]) => {
      const created = (
        await fx.call(owner, 'POST', `${base}/tasks`, {
          title,
          milestoneId: milestone,
        })
      ).json as {
        number: number;
      };
      await fx.call(owner, 'PUT', `${base}/tasks/${created.number}/labels`, {
        labelIds,
      });
      return created.number;
    };
    const open = await task('Open deliverable', [shared]);
    const hidden = await task('Confidential pricing', [internal]);
    const unlabelled = await task('Unlabelled note', []);
    await fx.call(owner, 'POST', `${base}/tasks/${open}/dependencies`, {
      blockerNumber: hidden,
    });

    // Scoping is for guests only, and only to this organization's labels.
    const set = (who: { id: string }, body: unknown) =>
      fx.call(owner, 'PUT', `${base}/members/${who.id}`, body);
    expect(
      (await set(member, { role: 'viewer', labelIds: [shared] })).status,
    ).toBe(400);
    expect(
      (
        await set(guest, {
          role: 'commenter',
          labelIds: ['00000000-0000-4000-8000-000000000000'],
        })
      ).status,
    ).toBe(400);
    expect(
      (await set(guest, { role: 'commenter', labelIds: [shared] })).status,
    ).toBe(204);
    const members = (await fx.call(owner, 'GET', `${base}/members`)).json as {
      members: { userId: string; labelIds: string[] | null }[];
    };
    expect(
      members.members.find((m) => m.userId === guest.id)?.labelIds,
    ).toEqual([shared]);

    const list = (await fx.call(guest, 'GET', `${base}/tasks`)).json as {
      tasks: { number: number }[];
    };
    expect(list.tasks.map((t) => t.number)).toEqual([open]);
    for (const number of [hidden, unlabelled]) {
      expect(
        (await fx.call(guest, 'GET', `${base}/tasks/${number}`)).status,
      ).toBe(404);
      expect(
        (await fx.call(guest, 'GET', `${base}/tasks/${number}/comments`))
          .status,
      ).toBe(404);
      expect(
        (await fx.call(guest, 'GET', `${base}/tasks/${number}/activity`))
          .status,
      ).toBe(404);
      expect(
        (await fx.call(guest, 'GET', `${base}/tasks/${number}/attachments`))
          .status,
      ).toBe(404);
      expect(
        (await fx.call(guest, 'GET', `${base}/tasks/${number}/time`)).status,
      ).toBe(404);
      expect(
        (
          await fx.call(guest, 'POST', `${base}/tasks/${number}/comments`, {
            body: 'Hi',
          })
        ).status,
      ).toBe(404);
    }
    // The visible task does not reveal its hidden blocker.
    const deps = (
      await fx.call(guest, 'GET', `${base}/tasks/${open}/dependencies`)
    ).json as {
      blockedBy: unknown[];
    };
    expect(deps.blockedBy).toEqual([]);
    const ownerDeps = (
      await fx.call(owner, 'GET', `${base}/tasks/${open}/dependencies`)
    ).json as {
      blockedBy: unknown[];
    };
    expect(ownerDeps.blockedBy).toHaveLength(1);
    // Search, milestone counts and analytics.
    const search = (await fx.call(guest, 'GET', `${org}/search?q=pricing`))
      .json as unknown[];
    expect(search).toEqual([]);
    expect(
      (
        (await fx.call(owner, 'GET', `${org}/search?q=pricing`))
          .json as unknown[]
      ).length,
    ).toBe(1);
    const milestones = (await fx.call(guest, 'GET', `${base}/milestones`))
      .json as { taskCount: number }[];
    expect(milestones[0]?.taskCount).toBe(1);
    expect((await fx.call(guest, 'GET', `${base}/analytics`)).status).toBe(403);

    // Mentions and notifications follow the same fence.
    expect(
      (
        await fx.call(owner, 'POST', `${base}/tasks/${hidden}/comments`, {
          body: 'FYI',
          mentions: [guest.id],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(owner, 'POST', `${base}/tasks/${open}/comments`, {
          body: 'FYI',
          mentions: [guest.id],
        })
      ).status,
    ).toBe(201);
    const organizationId = (
      await fx.db.query<{ id: string }>(
        'SELECT id FROM organizations WHERE slug = $1',
        [slug],
      )
    ).rows[0]?.id;
    await fx.call(owner, 'PUT', `${base}/tasks/${hidden}/assignees`, {
      userIds: [guest.id],
    });
    await notifyBatch(pool, organizationId ? { organizationId } : {});
    const inbox = (await fx.call(guest, 'GET', `${org}/notifications`))
      .json as {
      task: { number: number };
    }[];
    expect(inbox.map((i) => i.task.number)).toEqual([open]);

    // Removing the limit shows everything the role allows.
    expect(
      (await set(guest, { role: 'commenter', labelIds: null })).status,
    ).toBe(204);
    expect(
      (
        (await fx.call(guest, 'GET', `${base}/tasks`)).json as {
          tasks: unknown[];
        }
      ).tasks,
    ).toHaveLength(3);
    // Keeping the role without labelIds leaves the scope as it is.
    expect(
      (await set(guest, { role: 'commenter', labelIds: [shared] })).status,
    ).toBe(204);
    expect((await set(guest, { role: 'viewer' })).status).toBe(204);
    expect(
      (
        (await fx.call(guest, 'GET', `${base}/tasks`)).json as {
          tasks: unknown[];
        }
      ).tasks,
    ).toHaveLength(1);
  });
});
