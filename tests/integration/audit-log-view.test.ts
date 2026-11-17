import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

interface Page {
  items: { id: string; action: string; actor: { userId: string } | null }[];
  nextBefore: string | null;
}

const today = new Date().toISOString().slice(0, 10);

describe('organization audit log', () => {
  it('lets owners and admins read, filter, page and export it', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const admin = await fx.join(slug, owner, 'admin');
    const member = await fx.join(slug, owner, 'member');
    const guest = await fx.join(slug, owner, 'guest');
    const path = `/organizations/${slug}/audit-events`;

    const all = (await fx.call(admin, 'GET', path)).json as Page;
    const actions = all.items.map((i) => i.action);
    expect(actions).toContain('org.created');
    expect(actions.filter((a) => a === 'org.member.joined')).toHaveLength(3);
    // Newest first.
    expect(actions.indexOf('org.member.joined')).toBeLessThan(
      actions.indexOf('org.created'),
    );

    const joined = (await fx.call(owner, 'GET', `${path}?action=org.member`))
      .json as Page;
    expect(joined.items.length).toBeGreaterThanOrEqual(3);
    expect(joined.items.every((i) => i.action.startsWith('org.member.'))).toBe(
      true,
    );
    expect(
      ((await fx.call(owner, 'GET', `${path}?action=org.mem`)).json as Page)
        .items,
    ).toEqual([]);

    // Paging: two pages of one never repeat an event.
    const first = (await fx.call(owner, 'GET', `${path}?limit=1`)).json as Page;
    expect(first.items).toHaveLength(1);
    expect(first.nextBefore).toBe(first.items[0]?.id);
    const second = (
      await fx.call(owner, 'GET', `${path}?limit=1&before=${first.nextBefore}`)
    ).json as Page;
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.items[0]?.id).toBe(all.items[1]?.id);

    // Members and guests cannot read it; bad queries are refused.
    expect((await fx.call(member, 'GET', path)).status).toBe(403);
    expect((await fx.call(guest, 'GET', path)).status).toBe(403);
    expect(
      (await fx.call(member, 'GET', `${path}/export?from=${today}&to=${today}`))
        .status,
    ).toBe(403);
    expect((await fx.call(owner, 'GET', `${path}?limit=500`)).status).toBe(400);
    expect(
      (
        await fx.call(
          owner,
          'GET',
          `${path}/export?from=2025-01-01&to=2026-12-31`,
        )
      ).status,
    ).toBe(400);

    // Export: CSV with formula protection, and the export is itself audited.
    const exported = await fx.call(
      owner,
      'GET',
      `${path}/export?from=${today}&to=${today}`,
    );
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.headers['content-disposition']).toContain(
      `audit-${today}-to-${today}.csv`,
    );
    const csv = exported.json as string;
    expect(csv.split('\r\n')[0]).toContain('Time (UTC),Action,Actor id');
    expect(csv).toContain('org.member.joined');
    const after = (await fx.call(owner, 'GET', `${path}?action=org.audit`))
      .json as Page;
    expect(after.items[0]).toMatchObject({ action: 'org.audit.exported' });
  });

  it('never shows another organization’s events', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const stranger = await fx.account('stranger');
    const other = await fx.organization(stranger);
    await fx.join(other, stranger, 'member');

    expect(
      (await fx.call(stranger, 'GET', `/organizations/${slug}/audit-events`))
        .status,
    ).toBe(404);
    const mine = (
      await fx.call(owner, 'GET', `/organizations/${slug}/audit-events`)
    ).json as Page;
    expect(mine.items.some((i) => i.actor?.userId === stranger.id)).toBe(false);
    const theirs = (
      await fx.call(stranger, 'GET', `/organizations/${other}/audit-events`)
    ).json as Page;
    // A cursor from another organization does not page into it.
    expect(
      (
        (
          await fx.call(
            owner,
            'GET',
            `/organizations/${slug}/audit-events?before=${theirs.items[0]?.id}`,
          )
        ).json as Page
      ).items,
    ).toEqual([]);
  });
});
