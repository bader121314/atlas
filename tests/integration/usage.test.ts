import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { emailBatch } from '../../apps/worker/src/notifications/email';
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

interface Usage {
  members: number;
  guests: number;
  projects: { active: number; archived: number };
  tasks: number;
  storageBytes: number;
  months: {
    period: string;
    apiRequests: number;
    scimRequests: number;
    notificationEmails: number;
  }[];
}

const bearer = (token: string, path: string) =>
  fetch(fx.api.root + path, { headers: { authorization: `Bearer ${token}` } });

describe('usage metering', () => {
  it('reports size and counts metered requests and emails for this organization only', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const member = await fx.join(slug, owner, 'member');
    await fx.join(slug, owner, 'guest');
    const organizationId = (
      await fx.db.query<{ id: string }>(
        'SELECT id FROM organizations WHERE slug = $1',
        [slug],
      )
    ).rows[0]?.id;
    const base = `/organizations/${slug}/projects/USE`;
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'USE',
      name: 'Use',
    });
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'One',
      assigneeId: member.id,
    });
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Two' });

    const token = (
      (
        await fx.call(owner, 'POST', `/organizations/${slug}/api-tokens`, {
          name: 'Metered',
          scopes: ['tasks:read'],
        })
      ).json as { secret: string }
    ).secret;
    for (let i = 0; i < 3; i += 1)
      expect((await bearer(token, `${base}/tasks`)).status).toBe(200);
    const scim = (
      (await fx.call(owner, 'POST', `/organizations/${slug}/scim-tokens`))
        .json as {
        secret: string;
      }
    ).secret;
    expect((await bearer(scim, '/scim/v2/Users')).status).toBe(200);
    // Refused requests are not metered.
    expect((await bearer('atl_nonsense', `${base}/tasks`)).status).toBe(401);

    // One assignment email, counted when sent.
    await notifyBatch(pool, organizationId ? { organizationId } : {});
    await fx.db.query(
      `UPDATE notifications SET created_at = now() - interval '1 hour'
       WHERE organization_id = $1`,
      [organizationId],
    );
    expect(
      (
        await emailBatch(pool, async () => undefined, {
          delayMs: 0,
          webOrigin: 'https://atlas.test',
          ...(organizationId ? { organizationId } : {}),
        })
      ).sent,
    ).toBe(1);

    const usage = (await fx.call(owner, 'GET', `/organizations/${slug}/usage`))
      .json as Usage;
    expect(usage).toMatchObject({
      members: 2,
      guests: 1,
      projects: { active: 1, archived: 0 },
      tasks: 2,
      storageBytes: 0,
    });
    expect(usage.months).toHaveLength(6);
    const current = usage.months[0];
    expect(current?.period).toBe(new Date().toISOString().slice(0, 7));
    expect(current?.apiRequests).toBe(3);
    expect(current?.scimRequests).toBe(1);
    expect(current?.notificationEmails).toBe(1);

    // Members cannot read it; other organizations see none of it.
    expect(
      (await fx.call(member, 'GET', `/organizations/${slug}/usage`)).status,
    ).toBe(403);
    const other = await fx.account('other');
    const otherSlug = await fx.organization(other);
    const theirs = (
      await fx.call(other, 'GET', `/organizations/${otherSlug}/usage`)
    ).json as Usage;
    expect(theirs.months[0]).toMatchObject({ apiRequests: 0, scimRequests: 0 });
    expect(
      (await fx.call(other, 'GET', `/organizations/${slug}/usage`)).status,
    ).toBe(404);
  });
});
