import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

const config = {
  layout: 'table',
  filters: { assignee: 'me', priority: 'high' },
  sort: { field: 'due', direction: 'asc' },
};

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'VIEW',
    name: 'V',
  });
  const member = await fx.join(slug, owner, 'member');
  return {
    owner,
    member,
    slug,
    base: `/organizations/${slug}/projects/VIEW/views`,
  };
}

describe('saved views', () => {
  it('keeps private views private and shares shared ones', async () => {
    const { owner, member, base } = await setup();
    const mine = await fx.call(member, 'POST', base, {
      name: 'My urgent work',
      config,
    });
    expect(mine.status).toBe(201);
    expect(mine.json).toMatchObject({ shared: false, mine: true, config });
    const shared = await fx.call(owner, 'POST', base, {
      name: 'Team calendar',
      shared: true,
      config: { layout: 'calendar' },
    });
    expect(shared.json).toMatchObject({
      config: {
        layout: 'calendar',
        filters: {},
        sort: { field: 'number', direction: 'asc' },
      },
    });

    const memberViews = (await fx.call(member, 'GET', base)).json as {
      name: string;
      mine: boolean;
    }[];
    expect(memberViews.map((v) => [v.name, v.mine])).toEqual([
      ['My urgent work', true],
      ['Team calendar', false],
    ]);
    const ownerViews = (await fx.call(owner, 'GET', base)).json as {
      name: string;
    }[];
    expect(ownerViews.map((v) => v.name)).toEqual(['Team calendar']);

    expect(
      (await fx.call(member, 'POST', base, { name: 'MY URGENT WORK', config }))
        .status,
    ).toBe(409);
    expect(
      (
        await fx.call(member, 'POST', base, {
          name: 'Bad',
          config: { layout: 'gantt' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(member, 'POST', base, {
          name: 'Bad filter',
          config: { layout: 'list', filters: { owner: 'x' } },
        })
      ).status,
    ).toBe(400);
  });

  it('lets owners delete their views and managers delete shared ones', async () => {
    const { owner, member, base } = await setup();
    const priv = (
      await fx.call(owner, 'POST', base, { name: 'Private', config })
    ).json as { id: string };
    const team = (
      await fx.call(member, 'POST', base, {
        name: 'Shared',
        shared: true,
        config,
      })
    ).json as { id: string };
    const memberPriv = (
      await fx.call(member, 'POST', base, { name: 'Mine', config })
    ).json as {
      id: string;
    };

    // Someone else's private view looks nonexistent.
    expect((await fx.call(member, 'DELETE', `${base}/${priv.id}`)).status).toBe(
      404,
    );
    expect(
      (await fx.call(owner, 'DELETE', `${base}/${memberPriv.id}`)).status,
    ).toBe(404);
    // The owner is a project manager and may remove a shared view.
    expect((await fx.call(owner, 'DELETE', `${base}/${team.id}`)).status).toBe(
      204,
    );
    expect((await fx.call(owner, 'DELETE', `${base}/${priv.id}`)).status).toBe(
      204,
    );
  });

  it('stays inside its project', async () => {
    const a = await setup();
    const b = await setup();
    const view = (
      await fx.call(a.owner, 'POST', a.base, {
        name: 'A',
        shared: true,
        config,
      })
    ).json as { id: string };
    expect(
      (await fx.call(b.owner, 'DELETE', `${b.base}/${view.id}`)).status,
    ).toBe(404);
    expect((await fx.call(b.owner, 'GET', a.base)).status).toBe(404);
  });
});
