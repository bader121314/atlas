import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from './support/fixtures';
import type { Account } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

/** A request from a script: bearer token, no cookie, no Origin header. */
function script(token: string, method: string, path: string, body?: unknown) {
  return fetch(fx.api.root + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'API',
    name: 'Scripts',
  });
  const create = async (who: Account, scopes: string[]) => {
    const response = await fx.call(
      who,
      'POST',
      `/organizations/${slug}/api-tokens`,
      {
        name: 'CI script',
        scopes,
      },
    );
    return response as {
      status: number;
      json: { token: { id: string }; secret: string };
    };
  };
  return { owner, slug, base: `/organizations/${slug}/projects/API`, create };
}

describe('API tokens', () => {
  it('lets scripts read and write tasks within their scopes', async () => {
    const { owner, slug, base, create } = await setup();
    const reader = await create(owner, ['tasks:read']);
    expect(reader.status).toBe(201);
    expect(reader.json.secret).toMatch(/^atl_/);
    const listed = (
      await fx.call(owner, 'GET', `/organizations/${slug}/api-tokens`)
    ).json as {
      prefix: string;
    }[];
    expect(listed[0]?.prefix).toBe(reader.json.secret.slice(0, 12));
    expect(JSON.stringify(listed)).not.toContain(reader.json.secret);

    expect(
      (await script(reader.json.secret, 'GET', `${base}/tasks`)).status,
    ).toBe(200);
    expect(
      (
        await script(reader.json.secret, 'POST', `${base}/tasks`, {
          title: 'No',
        })
      ).status,
    ).toBe(403);

    const writer = await create(owner, ['tasks:read', 'tasks:write']);
    const made = await script(writer.json.secret, 'POST', `${base}/tasks`, {
      title: 'From CI',
    });
    expect(made.status).toBe(201);
    expect(((await made.json()) as { title: string }).title).toBe('From CI');
    expect(
      (
        await script(writer.json.secret, 'POST', `${base}/tasks/1/comments`, {
          body: 'Build passed',
        })
      ).status,
    ).toBe(201);
  });

  it('never reaches account, settings or other organizations', async () => {
    const { owner, slug, base, create } = await setup();
    const { json } = await create(owner, ['tasks:read', 'tasks:write']);
    const token = json.secret;
    expect((await script(token, 'GET', '/auth/session')).status).toBe(401);
    expect((await script(token, 'GET', '/organizations')).status).toBe(401);
    expect(
      (await script(token, 'GET', `/organizations/${slug}/members`)).status,
    ).toBe(403);
    expect(
      (await script(token, 'GET', `/organizations/${slug}/api-tokens`)).status,
    ).toBe(403);
    expect(
      (
        await script(token, 'POST', `/organizations/${slug}/projects`, {
          key: 'NEW',
          name: 'x',
        })
      ).status,
    ).toBe(403);
    expect(
      (await script(token, 'PATCH', base, { version: 1, name: 'Renamed' }))
        .status,
    ).toBe(403);
    expect((await script(token, 'POST', `${base}/exports`)).status).toBe(403);
    const other = await setup();
    expect((await script(token, 'GET', `${other.base}/tasks`)).status).toBe(
      404,
    );
    expect(
      (await script('atl_not-a-real-token', 'GET', `${base}/tasks`)).status,
    ).toBe(401);
    expect(
      (await script('session-cookie-value', 'GET', `${base}/tasks`)).status,
    ).toBe(401);
  });

  it('stops working when revoked, expired or when membership ends', async () => {
    const { owner, slug, base, create } = await setup();
    const revoked = await create(owner, ['tasks:read']);
    expect(
      (
        await fx.call(
          owner,
          'DELETE',
          `/organizations/${slug}/api-tokens/${revoked.json.token.id}`,
        )
      ).status,
    ).toBe(204);
    expect(
      (await script(revoked.json.secret, 'GET', `${base}/tasks`)).status,
    ).toBe(401);

    const expired = await create(owner, ['tasks:read']);
    await fx.db.query(
      `UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [expired.json.token.id],
    );
    expect(
      (await script(expired.json.secret, 'GET', `${base}/tasks`)).status,
    ).toBe(401);

    const member = await fx.join(slug, owner, 'member');
    const theirs = await create(member, ['tasks:read']);
    expect(
      (await script(theirs.json.secret, 'GET', `${base}/tasks`)).status,
    ).toBe(200);
    await fx.call(
      owner,
      'DELETE',
      `/organizations/${slug}/members/${member.id}`,
    );
    expect(
      (await script(theirs.json.secret, 'GET', `${base}/tasks`)).status,
    ).toBe(401);

    const audit = await fx.db.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE target_id = $1 ORDER BY occurred_at`,
      [revoked.json.token.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'api_token.created',
      'api_token.revoked',
    ]);
  });

  it('is not available to guests', async () => {
    const { owner, slug, create } = await setup();
    const guest = await fx.join(slug, owner, 'guest');
    expect((await create(guest, ['tasks:read'])).status).toBe(403);
  });
});
