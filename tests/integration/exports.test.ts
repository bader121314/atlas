import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { ObjectStore, storageSettings } from '../../packages/shared/src';
import { startFakeS3 } from '../../packages/shared/src/testing/fake-s3';
import {
  expireExports,
  runExports,
} from '../../apps/worker/src/exports/exporter';
import { startFixtures } from './support/fixtures';
import type { Account } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
let s3: Awaited<ReturnType<typeof startFakeS3>>;
let pool: Pool;
let store: ObjectStore;

beforeAll(async () => {
  s3 = await startFakeS3();
  fx = await startFixtures();
  for (const [name, value] of Object.entries(s3.env)) vi.stubEnv(name, value);
  store = new ObjectStore(
    storageSettings(s3.env) as NonNullable<ReturnType<typeof storageSettings>>,
  );
  pool = new Pool({
    connectionString: parseEnvironment(process.env).DATABASE_URL,
  });
});
afterAll(async () => {
  await pool.end();
  await fx.close();
  await s3.close();
});

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'EXP',
    name: 'Export',
  });
  const base = `/organizations/${slug}/projects/EXP`;
  await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Survey, phase 1' });
  await fx.call(owner, 'POST', `${base}/tasks`, { title: '=cmd|calc' });
  const org = await fx.db.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  const organizationId = org.rows[0]?.id ?? '';
  const run = () => runExports(pool, store, { organizationId });
  const start = async (who: Account) =>
    (await fx.call(who, 'POST', `${base}/exports`)) as {
      status: number;
      json: { id: string; status: string };
    };
  const download = (who: Account, id: string) =>
    fx.api.api('GET', `${base}/exports/${id}/download`, { cookie: who.cookie });
  return { owner, slug, base, organizationId, run, start, download };
}

describe('task exports', () => {
  it('builds a CSV in the background for the requester only', async () => {
    const { owner, slug, base, run, start, download } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await fx.call(owner, 'POST', `${base}/tasks/1/time`, {
      minutes: 90,
      spentOn: today,
    });
    await fx.call(owner, 'POST', `${base}/tasks/1/time`, {
      minutes: 15,
      spentOn: today,
    });
    const requested = await start(owner);
    expect(requested.status).toBe(201);
    expect(requested.json.status).toBe('queued');
    expect((await download(owner, requested.json.id)).status).toBe(409);

    expect(await run()).toEqual({ ready: 1, failed: 0 });
    const listed = (await fx.call(owner, 'GET', `${base}/exports`)).json as {
      status: string;
      rowCount: number;
    }[];
    expect(listed[0]).toMatchObject({ status: 'ready', rowCount: 2 });

    const file = await download(owner, requested.json.id);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(
      /attachment; filename\*=UTF-8''EXP-tasks-\d{4}-\d{2}-\d{2}\.csv/,
    );
    const text = await file.text();
    expect(text.split('\r\n')[0]).toBe(
      'Key,Title,Status,Priority,Assignee,Due,Labels,Milestone,Parent,Created,Completed,Start,Time logged (minutes)',
    );
    expect(text).toContain('EXP-1,"Survey, phase 1",To do,none');
    expect(text).toContain("EXP-2,'=cmd|calc");
    const rows = text.split('\r\n');
    expect(rows[1]?.endsWith(',105')).toBe(true);
    expect(rows[2]?.endsWith(',0')).toBe(true);

    // Another editor cannot see or fetch it; viewers cannot export at all.
    const member = await fx.join(slug, owner, 'member');
    expect((await fx.call(member, 'GET', `${base}/exports`)).json).toEqual([]);
    expect((await download(member, requested.json.id)).status).toBe(404);
    const viewer = await fx.join(slug, owner, 'member');
    expect(
      (
        await fx.call(owner, 'PUT', `${base}/members/${viewer.id}`, {
          role: 'viewer',
        })
      ).status,
    ).toBe(204);
    expect((await start(viewer)).status).toBe(403);
  });

  it('expires exports and refuses expired downloads', async () => {
    const { owner, organizationId, run, start, download } = await setup();
    const { json } = await start(owner);
    await run();
    await fx.db.query(
      `UPDATE exports SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [json.id],
    );
    expect((await download(owner, json.id)).status).toBe(410);
    expect(await expireExports(pool, store, { organizationId })).toBe(1);
    expect([...s3.objects.keys()].some((k) => k.includes(json.id))).toBe(false);
    expect((await download(owner, json.id)).status).toBe(410);
  });

  it('fails a queued export when the requester has lost access', async () => {
    const { owner, slug, base, run } = await setup();
    const member = await fx.join(slug, owner, 'member');
    const queued = (await fx.call(member, 'POST', `${base}/exports`)).json as {
      id: string;
    };
    await fx.call(owner, 'PATCH', `/organizations/${slug}/projects/EXP`, {
      version: 1,
      visibility: 'private',
    });
    expect(await run()).toEqual({ ready: 0, failed: 1 });
    const row = await fx.db.query<{
      status: string;
      storage_key: string | null;
    }>('SELECT status, storage_key FROM exports WHERE id = $1', [queued.id]);
    expect(row.rows[0]).toEqual({ status: 'failed', storage_key: null });
  });
});
