import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

async function setup(key = 'FLD') {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key,
    name: 'Fields',
  });
  const base = `/organizations/${slug}/projects/${key}`;
  await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Measure' });
  return { owner, slug, base };
}

describe('custom fields', () => {
  it('defines typed fields and stores valid values on tasks', async () => {
    const { owner, base } = await setup();
    const region = (
      await fx.call(owner, 'POST', `${base}/fields`, {
        name: 'Region',
        type: 'select',
        options: ['North', 'South'],
      })
    ).json as { id: string };
    const depth = (
      await fx.call(owner, 'POST', `${base}/fields`, {
        name: 'Depth (m)',
        type: 'number',
      })
    ).json as { id: string };
    expect(
      (
        await fx.call(owner, 'POST', `${base}/fields`, {
          name: 'region',
          type: 'text',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await fx.call(owner, 'POST', `${base}/fields`, {
          name: 'Empty',
          type: 'select',
          options: [],
        })
      ).status,
    ).toBe(400);

    const put = (fieldId: string, value: unknown) =>
      fx.call(owner, 'PUT', `${base}/tasks/1/fields/${fieldId}`, { value });
    expect((await put(region.id, 'South')).status).toBe(204);
    expect((await put(depth.id, 42.5)).status).toBe(204);
    expect((await put(region.id, 'East')).status).toBe(400);
    expect((await put(depth.id, 'deep')).status).toBe(400);

    const task = (await fx.call(owner, 'GET', `${base}/tasks/1`)).json as {
      fields: Record<string, unknown>;
      version: number;
    };
    expect(task.fields).toEqual({ [region.id]: 'South', [depth.id]: 42.5 });
    expect(task.version).toBe(3);

    // Removing an option clears values that used it.
    await fx.call(owner, 'PATCH', `${base}/fields/${region.id}`, {
      options: ['North'],
    });
    const after = (await fx.call(owner, 'GET', `${base}/tasks/1`)).json as {
      fields: Record<string, unknown>;
    };
    expect(after.fields).toEqual({ [depth.id]: 42.5 });

    expect((await put(depth.id, null)).status).toBe(204);
    expect(
      (await fx.call(owner, 'DELETE', `${base}/fields/${region.id}`)).status,
    ).toBe(204);
    const history = (await fx.call(owner, 'GET', `${base}/tasks/1/activity`))
      .json as {
      changes: Record<string, unknown>;
    }[];
    expect(history.filter((h) => h.changes.customField).length).toBe(3);
  });

  it('limits definitions to managers and keeps values inside the project', async () => {
    const a = await setup('AF');
    const b = await setup('BF');
    const member = await fx.join(a.slug, a.owner, 'member');
    expect(
      (
        await fx.call(member, 'POST', `${a.base}/fields`, {
          name: 'X',
          type: 'text',
        })
      ).status,
    ).toBe(403);
    const foreign = (
      await fx.call(b.owner, 'POST', `${b.base}/fields`, {
        name: 'Theirs',
        type: 'text',
      })
    ).json as { id: string };
    expect(
      (
        await fx.call(
          a.owner,
          'PUT',
          `${a.base}/tasks/1/fields/${foreign.id}`,
          { value: 'x' },
        )
      ).status,
    ).toBe(404);
    const own = (
      await fx.call(a.owner, 'POST', `${a.base}/fields`, {
        name: 'Notes',
        type: 'text',
      })
    ).json as { id: string };
    expect(
      (
        await fx.call(member, 'PUT', `${a.base}/tasks/1/fields/${own.id}`, {
          value: 'Editors may set values',
        })
      ).status,
    ).toBe(204);
  });
});
