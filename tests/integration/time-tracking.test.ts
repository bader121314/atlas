import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

const today = new Date().toISOString().slice(0, 10);

describe('time tracking', () => {
  it('logs, totals and removes time with project permissions', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const editor = await fx.join(slug, owner, 'member');
    const viewer = await fx.join(slug, owner, 'member');
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'TIME',
      name: 'Time',
      visibility: 'private',
    });
    const project = `/organizations/${slug}/projects/TIME`;
    await fx.call(owner, 'PUT', `${project}/members/${editor.id}`, {
      role: 'editor',
    });
    await fx.call(owner, 'PUT', `${project}/members/${viewer.id}`, {
      role: 'viewer',
    });
    await fx.call(owner, 'POST', `${project}/tasks`, { title: 'Estimate' });
    const time = `${project}/tasks/1/time`;

    const logged = await fx.call(editor, 'POST', time, {
      minutes: 90,
      spentOn: today,
      note: 'Survey',
    });
    expect(logged.status).toBe(201);
    await fx.call(owner, 'POST', time, { minutes: 30, spentOn: today });
    const list = (await fx.call(viewer, 'GET', time)).json as {
      totalMinutes: number;
      entries: { id: string; minutes: number; note: string | null }[];
    };
    expect(list.totalMinutes).toBe(120);
    expect(list.entries).toHaveLength(2);

    // Viewers read but cannot log; bad input and future days are refused.
    expect(
      (await fx.call(viewer, 'POST', time, { minutes: 5, spentOn: today }))
        .status,
    ).toBe(403);
    expect(
      (await fx.call(editor, 'POST', time, { minutes: 0, spentOn: today }))
        .status,
    ).toBe(400);
    expect(
      (
        await fx.call(editor, 'POST', time, {
          minutes: 5,
          spentOn: '2999-01-01',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fx.call(editor, 'POST', `${project}/tasks/99/time`, {
          minutes: 5,
          spentOn: today,
        })
      ).status,
    ).toBe(404);

    // Editors remove only their own entries; managers remove anyone's.
    const ownerEntry = list.entries.find((e) => e.minutes === 30)!;
    const editorEntry = (logged.json as { id: string }).id;
    expect(
      (await fx.call(editor, 'DELETE', `${time}/${ownerEntry.id}`)).status,
    ).toBe(403);
    expect(
      (await fx.call(owner, 'DELETE', `${time}/${editorEntry}`)).status,
    ).toBe(204);
    expect(
      ((await fx.call(owner, 'GET', time)).json as { totalMinutes: number })
        .totalMinutes,
    ).toBe(30);

    // Another organization cannot see or remove the entry.
    const stranger = await fx.account('stranger');
    await fx.organization(stranger);
    expect((await fx.call(stranger, 'GET', time)).status).toBe(404);
    expect(
      (await fx.call(stranger, 'DELETE', `${time}/${ownerEntry.id}`)).status,
    ).toBe(404);
  });

  it('reports time only for readable projects, and only your own unless admin', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const a = await fx.join(slug, owner, 'member');
    const b = await fx.join(slug, owner, 'member');
    const make = (key: string, visibility: string) =>
      fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
        key,
        name: key,
        visibility,
      });
    await make('OPEN', 'organization');
    await make('HIDE', 'private');
    await fx.call(
      owner,
      'PUT',
      `/organizations/${slug}/projects/HIDE/members/${b.id}`,
      { role: 'editor' },
    );
    for (const key of ['OPEN', 'HIDE'])
      await fx.call(
        owner,
        'POST',
        `/organizations/${slug}/projects/${key}/tasks`,
        { title: key },
      );
    const log = (who: typeof owner, key: string, minutes: number) =>
      fx.call(
        who,
        'POST',
        `/organizations/${slug}/projects/${key}/tasks/1/time`,
        {
          minutes,
          spentOn: today,
        },
      );
    await log(a, 'OPEN', 60);
    await log(b, 'OPEN', 15);
    await log(b, 'HIDE', 45);

    const report = async (who: typeof owner, from = today, to = today) =>
      fx.call(who, 'GET', `/organizations/${slug}/time?from=${from}&to=${to}`);
    const admin = (await report(owner)).json as {
      everyone: boolean;
      totalMinutes: number;
      rows: { userId: string; projectKey: string; minutes: number }[];
    };
    expect(admin.everyone).toBe(true);
    expect(admin.totalMinutes).toBe(120);
    expect(admin.rows).toHaveLength(3);

    const mine = (await report(a)).json as typeof admin;
    expect(mine.everyone).toBe(false);
    expect(mine.rows).toEqual([
      expect.objectContaining({
        userId: a.id,
        projectKey: 'OPEN',
        minutes: 60,
      }),
    ]);
    const theirs = (await report(b)).json as typeof admin;
    expect(theirs.totalMinutes).toBe(60);

    // Ranges are bounded and ordered.
    expect((await report(owner, '2026-01-01', '2026-12-31')).status).toBe(400);
    expect((await report(owner, today, '2000-01-01')).status).toBe(400);
    expect(
      (await fx.call(owner, 'GET', `/organizations/${slug}/time`)).status,
    ).toBe(400);
  });
});
