import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

interface Created {
  link: { id: string; prefix: string };
  token: string;
}

describe('public share links', () => {
  it('shows a narrow read-only task list to anyone with the token', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const manager = await fx.join(slug, owner, 'member');
    const editor = await fx.join(slug, owner, 'member');
    const project = `/organizations/${slug}/projects/PUB`;
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'PUB',
      name: 'Harbour plan',
      visibility: 'private',
    });
    await fx.call(owner, 'PUT', `${project}/members/${manager.id}`, {
      role: 'manager',
    });
    await fx.call(owner, 'PUT', `${project}/members/${editor.id}`, {
      role: 'editor',
    });
    await fx.call(owner, 'POST', `${project}/tasks`, {
      title: 'Dredge the channel',
      description: 'Budget is confidential',
      priority: 'high',
      assigneeId: editor.id,
      dueAt: '2026-12-01T00:00:00.000Z',
    });
    await fx.call(owner, 'POST', `${project}/tasks/1/comments`, {
      body: 'Secret note',
    });

    // Only managers create links; editors cannot.
    expect(
      (await fx.call(editor, 'POST', `${project}/share-links`, {})).status,
    ).toBe(403);
    const created = await fx.call(manager, 'POST', `${project}/share-links`, {
      expiresInDays: 7,
    });
    expect(created.status).toBe(201);
    const { token, link } = created.json as Created;
    expect(token).toMatch(/^ats_[A-Za-z0-9_-]{43}$/);
    expect(link.prefix).toBe(token.slice(0, 10));

    const open = (t: string) =>
      fx.call(undefined, 'GET', `/public/shares/${t}`);
    const view = await open(token);
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(view.headers['x-robots-tag']).toContain('noindex');
    expect(view.json).toMatchObject({
      project: { key: 'PUB', name: 'Harbour plan' },
      truncated: false,
      tasks: [
        {
          number: 1,
          title: 'Dredge the channel',
          category: 'todo',
          priority: 'high',
          dueOn: '2026-12-01',
        },
      ],
    });
    // The data fence: nothing about people, descriptions or comments.
    const raw = JSON.stringify(view.json);
    for (const secret of [
      'confidential',
      'Secret note',
      editor.id,
      manager.id,
      'organizationId',
    ])
      expect(raw).not.toContain(secret);

    // Unknown, malformed and other-project tokens all look the same.
    expect((await open(`ats_${'A'.repeat(43)}`)).status).toBe(404);
    expect((await open('nonsense')).status).toBe(404);

    // Listing never returns the token.
    const listed = (await fx.call(owner, 'GET', `${project}/share-links`))
      .json as { id: string }[];
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);

    // The link dies when its creator stops managing the project…
    await fx.call(owner, 'PUT', `${project}/members/${manager.id}`, {
      role: 'editor',
    });
    expect((await open(token)).status).toBe(404);
    await fx.call(owner, 'PUT', `${project}/members/${manager.id}`, {
      role: 'manager',
    });
    expect((await open(token)).status).toBe(200);

    // …when revoked…
    expect(
      (await fx.call(owner, 'DELETE', `${project}/share-links/${link.id}`))
        .status,
    ).toBe(204);
    expect((await open(token)).status).toBe(404);
    expect(
      (await fx.call(owner, 'DELETE', `${project}/share-links/${link.id}`))
        .status,
    ).toBe(404);

    // …and when the project is archived.
    const second = (await fx.call(owner, 'POST', `${project}/share-links`, {}))
      .json as Created;
    expect((await open(second.token)).status).toBe(200);
    const current = (await fx.call(owner, 'GET', project)).json as {
      version: number;
    };
    expect(
      (
        await fx.call(owner, 'PATCH', project, {
          version: current.version,
          status: 'archived',
        })
      ).status,
    ).toBe(200);
    expect((await open(second.token)).status).toBe(404);
  });

  it('keeps links inside their organization and caps them per project', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const project = `/organizations/${slug}/projects/CAP`;
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'CAP',
      name: 'Cap',
    });
    const first = (await fx.call(owner, 'POST', `${project}/share-links`, {}))
      .json as Created;
    for (let i = 1; i < 10; i += 1)
      await fx.call(owner, 'POST', `${project}/share-links`, {});
    expect(
      (await fx.call(owner, 'POST', `${project}/share-links`, {})).status,
    ).toBe(409);
    expect(
      (
        await fx.call(owner, 'POST', `${project}/share-links`, {
          expiresInDays: 365,
        })
      ).status,
    ).toBe(400);

    const stranger = await fx.account('stranger');
    const other = await fx.organization(stranger);
    expect(
      (await fx.call(stranger, 'GET', `${project}/share-links`)).status,
    ).toBe(404);
    expect(
      (
        await fx.call(
          stranger,
          'DELETE',
          `${project}/share-links/${first.link.id}`,
        )
      ).status,
    ).toBe(404);
    await fx.call(stranger, 'POST', `/organizations/${other}/projects`, {
      key: 'CAP',
      name: 'Mine',
    });
    expect(
      (
        await fx.call(
          stranger,
          'DELETE',
          `/organizations/${other}/projects/CAP/share-links/${first.link.id}`,
        )
      ).status,
    ).toBe(404);
  });
});
