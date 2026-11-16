import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { startAuthApp } from './support/auth-app';

// Membership changes go through invitations end to end. Each test builds its
// own organization so tests do not depend on one another's state.
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
    await db.query(
      "UPDATE organizations SET status = 'deleted' WHERE slug = ANY($1)",
      [slugs],
    );
    await db.query(
      `DELETE FROM invitations WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
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
  const slug = `inv-${run}-${counter}`;
  slugs.push(slug);
  const response = await api.api('POST', '/organizations', {
    cookie: owner.cookie,
    body: { name: `Org ${counter}`, slug },
  });
  expect(response.status).toBe(201);
  return slug;
}

function invite(slug: string, from: Account, email: string, role: string) {
  return api.api('POST', `/organizations/${slug}/invitations`, {
    cookie: from.cookie,
    body: { email, role },
  });
}

function accept(who: Account, token: string) {
  return api.api('POST', '/invitations/accept', {
    cookie: who.cookie,
    body: { token },
  });
}

function inviteToken(email: string): string {
  return api.mailer.token(email, '/invitations/accept');
}

/** Invites and accepts in one step, returning the member's account. */
async function member(slug: string, owner: Account, role: string) {
  const who = await account(role);
  expect((await invite(slug, owner, who.email, role)).status).toBe(201);
  expect((await accept(who, inviteToken(who.email))).status).toBe(201);
  return who;
}

function role(slug: string, by: Account, target: Account, next: string) {
  return api.api('PATCH', `/organizations/${slug}/members/${target.id}`, {
    cookie: by.cookie,
    body: { role: next },
  });
}

function remove(slug: string, by: Account, target: Account) {
  return api.api('DELETE', `/organizations/${slug}/members/${target.id}`, {
    cookie: by.cookie,
  });
}

async function myRole(slug: string, who: Account): Promise<string | number> {
  const response = await api.api('GET', `/organizations/${slug}`, {
    cookie: who.cookie,
  });
  if (response.status !== 200) return response.status;
  return ((await response.json()) as { role: string }).role;
}

describe('invitations', () => {
  it('lets an invited user join with the invited role', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const invitee = await account('invitee');
    const created = await invite(slug, owner, invitee.email, 'member');
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      email: invitee.email,
      role: 'member',
    });

    expect(await myRole(slug, invitee)).toBe(404);
    const joined = await accept(invitee, inviteToken(invitee.email));
    expect(joined.status).toBe(201);
    expect(await joined.json()).toMatchObject({ slug, role: 'member' });
    expect(await myRole(slug, invitee)).toBe('member');

    const audit = await db.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE organization_id = (SELECT id FROM organizations WHERE slug = $1)
       ORDER BY occurred_at, action`,
      [slug],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'org.created',
      'org.invitation.created',
      'org.member.joined',
    ]);
  });

  it('only accepts for the invited email, once', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const invitee = await account('invitee');
    const intruder = await account('intruder');
    await invite(slug, owner, invitee.email, 'member');
    const token = inviteToken(invitee.email);

    // Someone else holding the link cannot use it, and it stays valid.
    expect((await accept(intruder, token)).status).toBe(400);
    expect(await myRole(slug, intruder)).toBe(404);
    expect((await accept(invitee, token)).status).toBe(201);
    expect((await accept(invitee, token)).status).toBe(400);
  });

  it('rejects revoked, replaced and expired invitations', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const invitee = await account('invitee');

    const first = await invite(slug, owner, invitee.email, 'guest');
    const firstToken = inviteToken(invitee.email);
    const { id } = (await first.json()) as { id: string };
    const revoked = await api.api(
      'DELETE',
      `/organizations/${slug}/invitations/${id}`,
      { cookie: owner.cookie },
    );
    expect(revoked.status).toBe(204);
    expect((await accept(invitee, firstToken)).status).toBe(400);

    await invite(slug, owner, invitee.email, 'guest');
    const replaced = inviteToken(invitee.email);
    await invite(slug, owner, invitee.email, 'member');
    const current = inviteToken(invitee.email);
    expect((await accept(invitee, replaced)).status).toBe(400);

    await db.query(
      `UPDATE invitations
       SET created_at = now() - interval '8 days',
           expires_at = now() - interval '1 day'
       WHERE organization_id = (SELECT id FROM organizations WHERE slug = $1)
         AND accepted_at IS NULL AND revoked_at IS NULL`,
      [slug],
    );
    expect((await accept(invitee, current)).status).toBe(400);
  });

  it('enforces who may invite whom', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const admin = await member(slug, owner, 'admin');
    const regular = await member(slug, owner, 'member');
    const outsider = await account('outsider');
    const target = api.email(`target-${counter}`);

    expect((await invite(slug, outsider, target, 'guest')).status).toBe(404);
    expect((await invite(slug, regular, target, 'guest')).status).toBe(403);
    expect((await invite(slug, admin, target, 'admin')).status).toBe(403);
    expect((await invite(slug, admin, target, 'guest')).status).toBe(201);
    expect((await invite(slug, owner, target, 'owner')).status).toBe(400);
    expect((await invite(slug, owner, regular.email, 'guest')).status).toBe(
      409,
    );

    const listed = await api.api('GET', `/organizations/${slug}/invitations`, {
      cookie: regular.cookie,
    });
    expect(listed.status).toBe(403);
  });
});

describe('member management', () => {
  it('stops admins from escalating or touching privileged members', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const admin = await member(slug, owner, 'admin');
    const peer = await member(slug, owner, 'admin');
    const regular = await member(slug, owner, 'member');

    expect((await role(slug, admin, regular, 'admin')).status).toBe(403);
    expect((await role(slug, admin, peer, 'member')).status).toBe(403);
    expect((await role(slug, admin, owner, 'member')).status).toBe(403);
    expect((await role(slug, admin, admin, 'owner')).status).toBe(403);
    expect((await role(slug, regular, regular, 'admin')).status).toBe(403);
    expect((await role(slug, admin, regular, 'guest')).status).toBe(200);
    expect(await myRole(slug, regular)).toBe('guest');
  });

  it('transfers ownership but never leaves an organization without one', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const successor = await member(slug, owner, 'admin');

    expect((await role(slug, owner, owner, 'admin')).status).toBe(409);
    expect((await remove(slug, owner, owner)).status).toBe(409);
    expect(await myRole(slug, owner)).toBe('owner');

    expect((await role(slug, owner, successor, 'owner')).status).toBe(200);
    expect((await role(slug, owner, owner, 'admin')).status).toBe(200);
    expect(await myRole(slug, successor)).toBe('owner');
    expect(await myRole(slug, owner)).toBe('admin');
  });

  it('removes members, lets members leave, and allows rejoining by invitation', async () => {
    const owner = await account('owner');
    const slug = await organization(owner);
    const admin = await member(slug, owner, 'admin');
    const guest = await member(slug, owner, 'guest');
    const regular = await member(slug, owner, 'member');

    expect((await remove(slug, regular, guest)).status).toBe(403);
    expect((await remove(slug, admin, guest)).status).toBe(204);
    expect(await myRole(slug, guest)).toBe(404);
    expect((await remove(slug, regular, regular)).status).toBe(204);
    expect(await myRole(slug, regular)).toBe(404);

    expect((await invite(slug, owner, guest.email, 'member')).status).toBe(201);
    expect((await accept(guest, inviteToken(guest.email))).status).toBe(201);
    expect(await myRole(slug, guest)).toBe('member');
  });

  it('answers 404 for members of other organizations and malformed ids', async () => {
    const ownerA = await account('owner');
    const slugA = await organization(ownerA);
    const ownerB = await account('owner');
    const slugB = await organization(ownerB);
    const memberB = await member(slugB, ownerB, 'member');

    // Owner of A cannot reach a member of B through A's URL.
    expect((await role(slugA, ownerA, memberB, 'guest')).status).toBe(404);
    expect((await remove(slugA, ownerA, memberB)).status).toBe(404);
    expect(await myRole(slugB, memberB)).toBe('member');

    const malformed = await api.api(
      'PATCH',
      `/organizations/${slugA}/members/not-a-uuid`,
      { cookie: ownerA.cookie, body: { role: 'guest' } },
    );
    expect(malformed.status).toBe(404);
  });
});
