import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { ObjectStore, storageSettings } from '../../packages/shared/src';
import { checkBatch } from '../../apps/worker/src/attachments/checker';
import { startFakeS3 } from '../../packages/shared/src/testing/fake-s3';
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

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

interface Created {
  attachment: { id: string; status: string };
  upload: { url: string; headers: Record<string, string> };
}

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'ATT',
    name: 'Files',
  });
  const base = `/organizations/${slug}/projects/ATT`;
  await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Photos' });
  const org = await fx.db.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  const organizationId = org.rows[0]?.id ?? '';
  async function upload(
    who: Account,
    filename: string,
    contentType: string,
    body: Buffer,
    declared = body.length,
  ) {
    const created = await fx.call(who, 'POST', `${base}/tasks/1/attachments`, {
      filename,
      contentType,
      size: declared,
    });
    if (created.status !== 201) return { status: created.status, id: '' };
    const { attachment, upload: target } = created.json as Created;
    const put = await fetch(target.url, {
      method: 'PUT',
      headers: target.headers,
      body: new Uint8Array(body),
    });
    expect(put.status).toBe(200);
    const done = await fx.call(
      who,
      'POST',
      `${base}/attachments/${attachment.id}/complete`,
    );
    return {
      status: done.status,
      id: attachment.id,
      json: done.json as { status: string },
    };
  }
  const check = () => checkBatch(pool, store, { organizationId });
  const download = (who: Account, id: string) =>
    fx.api.api('GET', `${base}/attachments/${id}/download`, {
      cookie: who.cookie,
    });
  return { owner, slug, base, upload, check, download };
}

describe('attachments', () => {
  it('keeps uploads in quarantine until checked, then serves them signed', async () => {
    const { owner, base, upload, check, download } = await setup();
    const result = await upload(owner, '../photo.png', 'image/png', PNG);
    expect(result.status).toBe(200);
    expect(result.json?.status).toBe('quarantined');
    expect((await download(owner, result.id)).status).toBe(409);

    expect(await check()).toEqual({ clean: 1, rejected: 0 });
    const listed = (await fx.call(owner, 'GET', `${base}/tasks/1/attachments`))
      .json as {
      filename: string;
      status: string;
    }[];
    expect(listed).toEqual([
      expect.objectContaining({ filename: 'photo.png', status: 'clean' }),
    ]);

    const redirect = await fx.api.api(
      'GET',
      `${base}/attachments/${result.id}/download`,
      {
        cookie: owner.cookie,
      },
    );
    expect(redirect.status).toBe(200);
    // fetch follows the 302 to the signed storage URL.
    expect(redirect.url.startsWith(s3.endpoint)).toBe(true);
    expect(redirect.headers.get('content-disposition')).toContain(
      "attachment; filename*=UTF-8''photo.png",
    );
    expect(Buffer.from(await redirect.arrayBuffer())).toEqual(PNG);
  });

  it('rejects files whose content is not what they claim, or carries malware', async () => {
    const { owner, upload, check, download } = await setup();
    const fake = await upload(
      owner,
      'invoice.png',
      'image/png',
      Buffer.from('MZ\x90\x00 executable'),
    );
    const virus = await upload(
      owner,
      'notes.txt',
      'text/plain',
      Buffer.from(EICAR),
    );
    expect(await check()).toEqual({ clean: 0, rejected: 2 });
    for (const id of [fake.id, virus.id]) {
      expect((await download(owner, id)).status).toBe(409);
    }
    const reasons = await fx.db.query<{ rejection_reason: string }>(
      'SELECT rejection_reason FROM attachments WHERE id = ANY($1::uuid[]) ORDER BY rejection_reason',
      [[fake.id, virus.id]],
    );
    expect(reasons.rows.map((r) => r.rejection_reason)).toEqual([
      'malware',
      'type',
    ]);
    // Rejected content is removed from storage.
    for (const id of [fake.id, virus.id]) {
      expect([...s3.objects.keys()].some((k) => k.endsWith(id))).toBe(false);
    }
  });

  it('refuses unsupported types, oversized files and mismatched uploads', async () => {
    const { owner, base, upload } = await setup();
    const call = (body: Record<string, unknown>) =>
      fx.call(owner, 'POST', `${base}/tasks/1/attachments`, body);
    expect(
      (
        await call({
          filename: 'a.exe',
          contentType: 'application/x-msdownload',
          size: 10,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call({
          filename: 'big.png',
          contentType: 'image/png',
          size: 10 * 1024 * 1024 + 1,
        })
      ).status,
    ).toBe(400);
    // Declared size must match what arrived.
    expect(
      (await upload(owner, 'short.png', 'image/png', PNG, PNG.length + 5))
        .status,
    ).toBe(422);

    // The upload URL is bound to the declared type.
    const created = (
      await call({
        filename: 'x.png',
        contentType: 'image/png',
        size: PNG.length,
      })
    ).json as Created;
    const wrong = await fetch(created.upload.url, {
      method: 'PUT',
      headers: { 'content-type': 'text/html' },
      body: new Uint8Array(PNG),
    });
    expect(wrong.status).toBe(403);
  });

  it('applies project permissions and tenancy', async () => {
    const { owner, slug, base, upload, check } = await setup();
    const { id } = await upload(owner, 'map.png', 'image/png', PNG);
    await check();
    expect([...s3.objects.keys()].some((k) => k.endsWith(id))).toBe(true);
    const guest = await fx.join(slug, owner, 'guest');
    expect(
      (await fx.call(guest, 'GET', `${base}/tasks/1/attachments`)).status,
    ).toBe(404);
    const member = await fx.join(slug, owner, 'member');
    expect(
      (await fx.call(member, 'GET', `${base}/tasks/1/attachments`)).status,
    ).toBe(200);
    expect(
      (await fx.call(member, 'DELETE', `${base}/attachments/${id}`)).status,
    ).toBe(403);
    const outsider = await fx.account('outsider');
    expect(
      (
        await fx.api.api('GET', `${base}/attachments/${id}/download`, {
          cookie: outsider.cookie,
        })
      ).status,
    ).toBe(404);
    // Another organization cannot reach it by id through its own project.
    const other = await setup();
    expect((await other.download(other.owner, id)).status).toBe(404);
    expect(
      (await fx.call(owner, 'DELETE', `${base}/attachments/${id}`)).status,
    ).toBe(204);
    expect([...s3.objects.keys()].some((k) => k.endsWith(id))).toBe(false);
  });

  it('answers 503 when storage is not configured', async () => {
    const { owner, base } = await setup();
    vi.stubEnv('STORAGE_ENDPOINT', '');
    expect(
      (
        await fx.call(owner, 'POST', `${base}/tasks/1/attachments`, {
          filename: 'a.png',
          contentType: 'image/png',
          size: 5,
        })
      ).status,
    ).toBe(503);
    vi.stubEnv('STORAGE_ENDPOINT', s3.env.STORAGE_ENDPOINT);
  });
});
