import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { startAuthApp } from './support/auth-app';

let api: Awaited<ReturnType<typeof startAuthApp>>;
const db = new Client({
  connectionString: parseEnvironment(process.env).DATABASE_URL,
});
const run = randomUUID().slice(0, 8);
const slugs: string[] = [];

interface Account {
  email: string;
  cookie: string;
  id: string;
}

beforeAll(async () => {
  api = await startAuthApp();
  await db.connect();
});

afterAll(async () => {
  try {
    const orgs = `(SELECT id FROM organizations WHERE slug = ANY($1))`;
    await db.query(
      "UPDATE organizations SET status = 'deleted' WHERE slug = ANY($1)",
      [slugs],
    );
    await db.query(
      `DELETE FROM project_memberships WHERE organization_id IN ${orgs}`,
      [slugs],
    );
    await db.query(`DELETE FROM projects WHERE organization_id IN ${orgs}`, [
      slugs,
    ]);
    await db.query(`DELETE FROM invitations WHERE organization_id IN ${orgs}`, [
      slugs,
    ]);
    await db.query(
      `DELETE FROM organization_memberships WHERE organization_id IN ${orgs}`,
      [slugs],
    );
    await db.query('DELETE FROM organizations WHERE slug = ANY($1)', [slugs]);
  } finally {
    await db.end();
    await api.close();
  }
});

let counter = 0;
async function account(label: string): Promise<Account> {
  counter += 1;
  const email = await api.verifiedAccount(`${label}${counter}`);
  const cookie = await api.login(email);
  const user = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE email_normalized = $1',
    [email],
  );
  return { email, cookie, id: user.rows[0]?.id ?? '' };
}

async function organization(owner: Account): Promise<string> {
  counter += 1;
  const slug = `prj-${run}-${counter}`;
  slugs.push(slug);
  const response = await api.api('POST', '/organizations', {
    cookie: owner.cookie,
    body: { name: `Org ${counter}`, slug },
  });
  expect(response.status).toBe(201);
  return slug;
}

async function join(slug: string, owner: Account, role: string) {
  const who = await account(role);
  await api.api('POST', `/organizations/${slug}/invitations`, {
    cookie: owner.cookie,
    body: { email: who.email, role },
  });
  const accepted = await api.api('POST', '/invitations/accept', {
    cookie: who.cookie,
    body: { token: api.mailer.token(who.email, '/invitations/accept') },
  });
  expect(accepted.status).toBe(201);
  return who;
}

function projects(slug: string, path = '') {
  return `/organizations/${slug}/projects${path}`;
}

async function createProject(
  slug: string,
  who: Account,
  key: string,
  visibility = 'organization',
) {
  return api.api('POST', projects(slug), {
    cookie: who.cookie,
    body: { key, name: `Project ${key}`, visibility },
  });
}

async function status(
  who: Account,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await api.api(method, path, {
    cookie: who.cookie,
    ...(body === undefined ? {} : { body }),
  });
  return response.status;
}

describe('projects', () => {
  it('creates projects and applies organization visibility', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const member = await join(slug, owner, 'member');
    const guest = await join(slug, owner, 'guest');

    const created = await createProject(slug, member, 'OPEN');
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      key: 'OPEN',
      role: 'manager',
      version: 1,
      visibility: 'organization',
    });
    expect((await createProject(slug, owner, 'OPEN')).status).toBe(409);
    expect((await createProject(slug, owner, 'lower')).status).toBe(400);
    expect((await createProject(slug, guest, 'GUEST')).status).toBe(403);

    // Owner manages everything; guests see nothing until added.
    const ownerView = await api.api('GET', projects(slug, '/OPEN'), {
      cookie: owner.cookie,
    });
    expect(((await ownerView.json()) as { role: string }).role).toBe('manager');
    expect(await status(guest, 'GET', projects(slug, '/OPEN'))).toBe(404);
    const guestList = await api.api('GET', projects(slug), {
      cookie: guest.cookie,
    });
    expect(
      ((await guestList.json()) as { projects: unknown[] }).projects,
    ).toEqual([]);
  });

  it('hides private projects from members who are not on them', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const insider = await join(slug, owner, 'member');
    const outsider = await join(slug, owner, 'member');
    expect((await createProject(slug, owner, 'SECRET', 'private')).status).toBe(
      201,
    );

    expect(await status(outsider, 'GET', projects(slug, '/SECRET'))).toBe(404);
    expect(
      await status(
        owner,
        'PUT',
        projects(slug, `/SECRET/members/${insider.id}`),
        {
          role: 'viewer',
        },
      ),
    ).toBe(204);
    const view = await api.api('GET', projects(slug, '/SECRET'), {
      cookie: insider.cookie,
    });
    expect(((await view.json()) as { role: string }).role).toBe('viewer');
    // Viewers cannot edit or manage.
    expect(
      await status(insider, 'PATCH', projects(slug, '/SECRET'), {
        version: 1,
        name: 'Renamed',
      }),
    ).toBe(403);
    expect(
      await status(
        insider,
        'PUT',
        projects(slug, `/SECRET/members/${outsider.id}`),
        {
          role: 'viewer',
        },
      ),
    ).toBe(403);
    // Removing the explicit membership hides the project again.
    expect(
      await status(
        owner,
        'DELETE',
        projects(slug, `/SECRET/members/${insider.id}`),
      ),
    ).toBe(204);
    expect(await status(insider, 'GET', projects(slug, '/SECRET'))).toBe(404);
  });

  it('caps guests at commenter', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const guest = await join(slug, owner, 'guest');
    await createProject(slug, owner, 'CAP');
    const path = projects(slug, `/CAP/members/${guest.id}`);
    expect(await status(owner, 'PUT', path, { role: 'editor' })).toBe(400);
    expect(await status(owner, 'PUT', path, { role: 'commenter' })).toBe(204);
    const view = await api.api('GET', projects(slug, '/CAP'), {
      cookie: guest.cookie,
    });
    expect(((await view.json()) as { role: string }).role).toBe('commenter');
  });

  it('rejects stale updates with 409', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    await createProject(slug, owner, 'VER');
    const first = await api.api('PATCH', projects(slug, '/VER'), {
      cookie: owner.cookie,
      body: { version: 1, name: 'First edit' },
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      name: 'First edit',
      version: 2,
    });
    expect(
      await status(owner, 'PATCH', projects(slug, '/VER'), {
        version: 1,
        name: 'Stale edit',
      }),
    ).toBe(409);
    const archived = await api.api('PATCH', projects(slug, '/VER'), {
      cookie: owner.cookie,
      body: { version: 2, status: 'archived' },
    });
    expect(await archived.json()).toMatchObject({
      name: 'First edit',
      status: 'archived',
      version: 3,
    });
  });

  it('keeps projects and members inside their organization', async () => {
    const ownerA = await account('owner');
    const slugA = await organization(ownerA);
    const ownerB = await account('owner');
    const slugB = await organization(ownerB);
    await createProject(slugB, ownerB, 'BETA');

    // Same key in another organization is a different project.
    expect((await createProject(slugA, ownerA, 'BETA')).status).toBe(201);
    expect(await status(ownerA, 'GET', projects(slugB, '/BETA'))).toBe(404);
    // A member of B cannot be added to a project in A.
    expect(
      await status(
        ownerA,
        'PUT',
        projects(slugA, `/BETA/members/${ownerB.id}`),
        {
          role: 'viewer',
        },
      ),
    ).toBe(404);
    // Unknown fields such as organizationId are rejected.
    expect(
      await status(ownerA, 'PATCH', projects(slugA, '/BETA'), {
        version: 1,
        organizationId: randomUUID(),
      }),
    ).toBe(400);
  });
});
