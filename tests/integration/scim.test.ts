import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD } from './support/auth-app';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

interface ScimUser {
  id: string;
  userName: string;
  externalId?: string;
  displayName: string;
  active: boolean;
}

/** Calls SCIM with a bearer token and `application/scim+json` bodies. */
async function scim(
  token: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await fx.api.api(method, `/scim/v2${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined
        ? {}
        : { 'content-type': 'application/scim+json' }),
    },
    ...(body === undefined ? {} : { body }),
  });
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    json: (text ? JSON.parse(text) : undefined) as Record<string, unknown>,
  };
}

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  const created = await fx.call(
    owner,
    'POST',
    `/organizations/${slug}/scim-tokens`,
  );
  expect(created.status).toBe(201);
  const { secret } = created.json as { secret: string };
  return { owner, slug, token: secret };
}

const SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';

describe('SCIM provisioning', () => {
  it('provisions, finds, suspends, reactivates and removes members', async () => {
    const { owner, slug, token } = await setup();
    const email = `scim-${Date.now()}@example.test`;
    const created = await scim(token, 'POST', '/Users', {
      schemas: [SCHEMA],
      userName: email.toUpperCase(),
      externalId: 'okta-001',
      name: { givenName: 'Noura', familyName: 'Saleh' },
      emails: [{ value: email, primary: true, type: 'work' }],
      title: 'Surveyor',
      active: true,
    });
    expect(created.status).toBe(201);
    expect(created.type).toContain('application/scim+json');
    const user = created.json as unknown as ScimUser;
    expect(user).toMatchObject({
      userName: email,
      externalId: 'okta-001',
      displayName: 'Noura Saleh',
      active: true,
    });

    // The new person gets a welcome link, sets a password and can sign in.
    const welcome = fx.api.mailer.sent.filter((m) => m.to === email).at(-1);
    expect(welcome?.subject).toContain('You have been added to');
    const reset = await fx.api.api('POST', '/auth/password-reset/confirm', {
      body: {
        token: fx.api.mailer.token(email, '/reset-password'),
        password: PASSWORD,
      },
    });
    expect(reset.status).toBe(204);
    const cookie = await fx.api.login(email);
    const member = { email, cookie, id: user.id };
    expect(
      (await fx.call(member, 'GET', `/organizations/${slug}`)).status,
    ).toBe(200);

    // Identity providers look people up before creating them.
    const found = await scim(
      token,
      'GET',
      `/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`,
    );
    expect(found.json).toMatchObject({
      totalResults: 1,
      Resources: [{ id: user.id }],
    });
    const byExternal = await scim(
      token,
      'GET',
      `/Users?filter=${encodeURIComponent('externalId eq "okta-001"')}`,
    );
    expect(byExternal.json.totalResults).toBe(1);
    expect(
      (
        await scim(
          token,
          'GET',
          `/Users?filter=${encodeURIComponent('title co "x"')}`,
        )
      ).json,
    ).toMatchObject({
      status: '400',
      scimType: 'invalidFilter',
    });
    expect(
      (await scim(token, 'POST', '/Users', { userName: email })).json,
    ).toMatchObject({
      status: '409',
      scimType: 'uniqueness',
    });

    // Suspending (Entra sends "False" as a string) ends access at once.
    const suspended = await scim(token, 'PATCH', `/Users/${user.id}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'active', value: 'False' }],
    });
    expect(suspended.json.active).toBe(false);
    expect(
      (await fx.call(member, 'GET', `/organizations/${slug}`)).status,
    ).toBe(404);

    // Profile changes from the directory are ignored; state comes back.
    const back = await scim(token, 'PATCH', `/Users/${user.id}`, {
      Operations: [
        { op: 'replace', value: { active: true, displayName: 'Changed' } },
      ],
    });
    expect(back.json).toMatchObject({
      active: true,
      displayName: 'Noura Saleh',
    });
    expect(
      (await fx.call(member, 'GET', `/organizations/${slug}`)).status,
    ).toBe(200);

    expect((await scim(token, 'DELETE', `/Users/${user.id}`)).status).toBe(204);
    expect((await scim(token, 'GET', `/Users/${user.id}`)).status).toBe(404);
    expect(
      (await fx.call(member, 'GET', `/organizations/${slug}`)).status,
    ).toBe(404);

    // The audit log shows provisioning without an acting person.
    const audit = (
      await fx.call(
        owner,
        'GET',
        `/organizations/${slug}/audit-events?action=org.member`,
      )
    ).json as { items: { action: string }[] };
    expect(audit.items.map((i) => i.action)).toEqual(
      expect.arrayContaining([
        'org.member.provisioned',
        'org.member.deprovisioned',
        'org.member.reactivated',
      ]),
    );
  });

  it('adds existing accounts without changing them, and protects owners and admins', async () => {
    const { owner, slug, token } = await setup();
    const existing = await fx.account('existing');
    const added = await scim(token, 'POST', '/Users', {
      userName: existing.email,
      displayName: 'Someone Else',
    });
    expect(added.status).toBe(201);
    expect(added.json.displayName).not.toBe('Someone Else');
    expect(
      fx.api.mailer.sent.some(
        (m) =>
          m.to === existing.email && m.subject.includes('You have been added'),
      ),
    ).toBe(false);
    expect(
      (await fx.call(existing, 'GET', `/organizations/${slug}`)).status,
    ).toBe(200);

    const admin = await fx.join(slug, owner, 'admin');
    for (const id of [owner.id, admin.id]) {
      expect(
        (
          await scim(token, 'PATCH', `/Users/${id}`, {
            Operations: [{ op: 'replace', path: 'active', value: false }],
          })
        ).json,
      ).toMatchObject({ status: '403', scimType: 'mutability' });
      expect((await scim(token, 'DELETE', `/Users/${id}`)).status).toBe(403);
    }
  });

  it('accepts only live tokens for their own organization', async () => {
    const a = await setup();
    const b = await setup();
    const inB = await scim(b.token, 'POST', '/Users', {
      userName: `b-${Date.now()}@example.test`,
    });
    const id = (inB.json as unknown as ScimUser).id;

    // A's token cannot see or change B's people.
    expect((await scim(a.token, 'GET', `/Users/${id}`)).status).toBe(404);
    expect((await scim(a.token, 'DELETE', `/Users/${id}`)).status).toBe(404);
    expect(
      (
        (await scim(a.token, 'GET', '/Users')).json.Resources as ScimUser[]
      ).some((u) => u.id === id),
    ).toBe(false);

    // Missing, wrong and revoked tokens are refused; sessions are not tokens.
    expect((await scim('nonsense', 'GET', '/Users')).status).toBe(401);
    const noAuth = await fx.api.api('GET', '/scim/v2/Users', {
      cookie: a.owner.cookie,
    });
    expect(noAuth.status).toBe(401);
    const listed = (
      await fx.call(a.owner, 'GET', `/organizations/${a.slug}/scim-tokens`)
    ).json as { id: string }[];
    expect(JSON.stringify(listed)).not.toContain(a.token);
    expect(
      (
        await fx.call(
          a.owner,
          'DELETE',
          `/organizations/${a.slug}/scim-tokens/${listed[0]?.id}`,
        )
      ).status,
    ).toBe(204);
    expect((await scim(a.token, 'GET', '/Users')).status).toBe(401);

    // Only owners manage tokens, at most two at a time.
    const admin = await fx.join(b.slug, b.owner, 'admin');
    expect(
      (await fx.call(admin, 'POST', `/organizations/${b.slug}/scim-tokens`))
        .status,
    ).toBe(403);
    expect(
      (await fx.call(b.owner, 'POST', `/organizations/${b.slug}/scim-tokens`))
        .status,
    ).toBe(201);
    expect(
      (await fx.call(b.owner, 'POST', `/organizations/${b.slug}/scim-tokens`))
        .status,
    ).toBe(409);
    expect(
      (await scim(b.token, 'GET', '/ServiceProviderConfig')).json.patch,
    ).toEqual({ supported: true });
  });
});
