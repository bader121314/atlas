import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { startAuthApp } from './support/auth-app';

// Two organizations, three accounts (M1 exit criteria). Alice owns A, Bob owns
// B, Carol belongs to A with whatever role a test sets. Memberships beyond
// the owner are inserted directly until invitations exist.
let api: Awaited<ReturnType<typeof startAuthApp>>;
const db = new Client({
  connectionString: parseEnvironment(process.env).DATABASE_URL,
});
const run = randomUUID().slice(0, 8);
const slugA = `alpha-${run}`;
const slugB = `beta-${run}`;
const slugs = [slugA, slugB];
let alice = '';
let bob = '';
let carol = '';
let carolId = '';
let orgA = '';

const orgs = (path = '') => `/organizations${path}`;

beforeAll(async () => {
  api = await startAuthApp();
  await db.connect();
  alice = await api.login(await api.verifiedAccount('alice'));
  bob = await api.login(await api.verifiedAccount('bob'));
  const carolEmail = await api.verifiedAccount('carol');
  carol = await api.login(carolEmail);
  const user = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE email_normalized = $1',
    [carolEmail],
  );
  carolId = user.rows[0]?.id ?? '';

  const a = await api.api('POST', orgs(), {
    cookie: alice,
    body: { name: 'Alpha', slug: slugA },
  });
  expect(a.status).toBe(201);
  orgA = ((await a.json()) as { id: string }).id;
  const b = await api.api('POST', orgs(), {
    cookie: bob,
    body: { name: 'Beta', slug: slugB },
  });
  expect(b.status).toBe(201);
});

afterAll(async () => {
  try {
    // Lift the active-owner requirement, then remove test organizations.
    await db.query(
      "UPDATE organizations SET status = 'deleted' WHERE slug = ANY($1)",
      [slugs],
    );
    await db.query(
      `DELETE FROM organization_memberships WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
    await db.query('DELETE FROM organizations WHERE slug = ANY($1)', [slugs]);
  } finally {
    await db.end();
    await api.close();
  }
});

async function setCarolRole(role: string, state = 'active'): Promise<void> {
  await db.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, state)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, state = EXCLUDED.state`,
    [orgA, carolId, role, state],
  );
}

describe('creating and listing organizations', () => {
  it('makes the creator the owner and records the event', async () => {
    const response = await api.api('GET', orgs(`/${slugA}`), {
      cookie: alice,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      slug: slugA,
      name: 'Alpha',
      role: 'owner',
    });
    const audit = await db.query(
      "SELECT 1 FROM audit_events WHERE action = 'org.created' AND organization_id = $1",
      [orgA],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('lists only organizations the caller belongs to', async () => {
    const response = await api.api('GET', orgs(), { cookie: bob });
    const { organizations } = (await response.json()) as {
      organizations: { slug: string; role: string }[];
    };
    const mine = organizations.filter((o) => slugs.includes(o.slug));
    expect(mine).toEqual([
      expect.objectContaining({ slug: slugB, role: 'owner' }),
    ]);
  });

  it('rejects duplicate and malformed slugs', async () => {
    const duplicate = await api.api('POST', orgs(), {
      cookie: bob,
      body: { name: 'Copy', slug: slugA },
    });
    expect(duplicate.status).toBe(409);
    for (const slug of ['A', 'ab', 'Has Space', '-dash', 'dash-']) {
      const response = await api.api('POST', orgs(), {
        cookie: bob,
        body: { name: 'Bad', slug },
      });
      expect(response.status).toBe(400);
    }
  });

  it('requires a session', async () => {
    expect((await api.api('GET', orgs())).status).toBe(401);
    expect((await api.api('GET', orgs(`/${slugA}`))).status).toBe(401);
  });
});

describe('tenant isolation', () => {
  it('hides other organizations entirely from non-members', async () => {
    for (const [method, path] of [
      ['GET', orgs(`/${slugA}`)],
      ['GET', orgs(`/${slugA}/members`)],
      ['PATCH', orgs(`/${slugA}`)],
    ] as const) {
      const response = await api.api(method, path, {
        cookie: bob,
        ...(method === 'PATCH' ? { body: { name: 'Taken over' } } : {}),
      });
      // Same answer as an organization that does not exist.
      expect(response.status).toBe(404);
    }
    const missing = await api.api('GET', orgs(`/missing-${run}`), {
      cookie: bob,
    });
    expect(missing.status).toBe(404);
    const unchanged = await api.api('GET', orgs(`/${slugA}`), {
      cookie: alice,
    });
    expect(((await unchanged.json()) as { name: string }).name).toBe('Alpha');
  });

  it('applies the role matrix to members', async () => {
    await setCarolRole('guest');
    expect(
      (await api.api('GET', orgs(`/${slugA}`), { cookie: carol })).status,
    ).toBe(200);
    expect(
      (await api.api('GET', orgs(`/${slugA}/members`), { cookie: carol }))
        .status,
    ).toBe(403);

    await setCarolRole('member');
    const members = await api.api('GET', orgs(`/${slugA}/members`), {
      cookie: carol,
    });
    expect(members.status).toBe(200);
    const body = (await members.json()) as { members: { role: string }[] };
    expect(body.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
    const denied = await api.api('PATCH', orgs(`/${slugA}`), {
      cookie: carol,
      body: { name: 'Member rename' },
    });
    expect(denied.status).toBe(403);

    await setCarolRole('admin');
    const renamed = await api.api('PATCH', orgs(`/${slugA}`), {
      cookie: carol,
      body: { name: 'Alpha Renamed' },
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      name: 'Alpha Renamed',
      role: 'admin',
    });
    const audit = await db.query(
      "SELECT 1 FROM audit_events WHERE action = 'org.updated' AND organization_id = $1 AND actor_user_id = $2",
      [orgA, carolId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('treats suspended members as non-members', async () => {
    await setCarolRole('admin', 'suspended');
    const response = await api.api('GET', orgs(`/${slugA}`), {
      cookie: carol,
    });
    expect(response.status).toBe(404);
    const list = await api.api('GET', orgs(), { cookie: carol });
    const { organizations } = (await list.json()) as {
      organizations: { slug: string }[];
    };
    expect(organizations.map((o) => o.slug)).not.toContain(slugA);
  });

  it('ignores organization ids supplied in the request body', async () => {
    await setCarolRole('admin');
    const response = await api.api('PATCH', orgs(`/${slugA}`), {
      cookie: carol,
      body: { name: 'Alpha', organizationId: randomUUID() },
    });
    // Unknown fields are rejected outright rather than silently honored.
    expect(response.status).toBe(400);
  });
});
