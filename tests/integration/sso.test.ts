import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DomainResolver } from '../../apps/api/src/domains/domain-resolver';
import { PASSWORD } from './support/auth-app';
import { startFixtures } from './support/fixtures';

/** A minimal OpenID provider: discovery, keys and a PKCE-checking token endpoint. */
function fakeProvider() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'k1',
    use: 'sig',
    alg: 'RS256',
  };
  const codes = new Map<string, { challenge: string; idToken: string }>();
  let issuer = '';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration')
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/token') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const entry = codes.get(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const ok =
          entry &&
          form.get('client_secret') === 'provider-secret' &&
          createHash('sha256').update(verifier).digest('base64url') ===
            entry.challenge;
        if (!ok) return json(400, { error: 'invalid_grant' });
        codes.delete(form.get('code') ?? '');
        json(200, { id_token: entry.idToken, token_type: 'Bearer' });
      });
      return;
    }
    json(404, {});
  });
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    server,
    get issuer() {
      return issuer;
    },
    async listen() {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    /** Issues a code the token endpoint will exchange for this ID token. */
    issue(challenge: string, claims: Record<string, unknown>, tamper = false) {
      const now = Math.floor(Date.now() / 1000);
      const head = segment({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
      const body = segment({
        iss: issuer,
        aud: 'atlas-client',
        iat: now,
        exp: now + 300,
        ...claims,
      });
      let signature = sign(
        'sha256',
        Buffer.from(`${head}.${body}`),
        privateKey,
      ).toString('base64url');
      if (tamper)
        signature = signature.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
      const code = `code-${Math.random().toString(36).slice(2)}`;
      codes.set(code, { challenge, idToken: `${head}.${body}.${signature}` });
      return code;
    },
  };
}

let fx: Awaited<ReturnType<typeof startFixtures>>;
const provider = fakeProvider();
const dns = new Map<string, string[]>();
beforeAll(async () => {
  vi.stubEnv('SSO_SECRET_KEY', 'test-only-sso-sealing-key-0123456789abcdef');
  vi.stubEnv('SSO_ALLOW_HTTP', 'true');
  vi.stubEnv('SSO_ALLOWED_HOSTS', '127.0.0.1');
  await provider.listen();
  fx = await startFixtures();
  const resolver = fx.api.app.get(DomainResolver, { strict: false });
  resolver.txt = async (name: string) => dns.get(name) ?? [];
});
afterAll(async () => {
  await fx.close();
  provider.server.close();
});

const raw = (path: string, cookie?: string) =>
  fetch(fx.api.root + path, {
    redirect: 'manual',
    ...(cookie ? { headers: { cookie } } : {}),
  });

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  const domain = `sso-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.example`;
  const added = (
    await fx.call(owner, 'POST', `/organizations/${slug}/domains`, { domain })
  ).json as {
    id: string;
    record: { name: string; value: string };
  };
  dns.set(added.record.name, [added.record.value]);
  await fx.call(
    owner,
    'POST',
    `/organizations/${slug}/domains/${added.id}/verify`,
  );
  const settings = (body: Record<string, unknown>) =>
    fx.call(owner, 'PUT', `/organizations/${slug}/sso`, {
      issuer: provider.issuer,
      clientId: 'atlas-client',
      enabled: true,
      requireSso: false,
      ...body,
    });
  return { owner, slug, domain, settings };
}

/** Runs the browser part: start, then the provider's redirect back. */
async function signIn(
  email: string,
  claims: (nonce: string) => Record<string, unknown>,
  tamper = false,
) {
  const start = await raw(`/auth/sso/start?email=${encodeURIComponent(email)}`);
  expect(start.status).toBe(302);
  const location = new URL(start.headers.get('location') ?? '');
  if (location.pathname !== '/authorize')
    return { location: location.toString(), cookie: '' };
  const params = location.searchParams;
  expect(params.get('code_challenge_method')).toBe('S256');
  const code = provider.issue(
    params.get('code_challenge') ?? '',
    claims(params.get('nonce') ?? ''),
    tamper,
  );
  const state = params.get('state') ?? '';
  const back = await raw(`/auth/sso/callback?state=${state}&code=${code}`);
  return {
    state,
    location: back.headers.get('location') ?? '',
    cookie: (back.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
  };
}

describe('single sign-on', () => {
  it('signs people in through the provider and adds them as members', async () => {
    const { slug, domain, settings } = await setup();
    const saved = await settings({ clientSecret: 'provider-secret' });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.json)).not.toContain('provider-secret');
    expect(saved.json).toMatchObject({
      enabled: true,
      redirectUri: expect.stringMatching(/\/api\/auth\/sso\/callback$/),
    });

    const email = `layla@${domain}`;
    const result = await signIn(email, (nonce) => ({
      sub: 'idp-1',
      email,
      email_verified: true,
      name: 'Layla Hamad',
      nonce,
    }));
    expect(result.location).toMatch(new RegExp(`/organizations/${slug}$`));
    expect(result.cookie).toMatch(/^atlas_session=/);
    const me = await fx.api.api('GET', '/auth/session', {
      cookie: result.cookie,
    });
    expect(await me.json()).toMatchObject({
      user: { displayName: 'Layla Hamad' },
    });
    expect(
      (
        await fx.api.api('GET', `/organizations/${slug}`, {
          cookie: result.cookie,
        })
      ).status,
    ).toBe(200);

    // A state is single use.
    const replay = await raw(
      `/auth/sso/callback?state=${result.state}&code=anything`,
    );
    expect(replay.headers.get('location')).toContain('/login/sso?error=failed');
  });

  it('refuses bad tokens, foreign domains and unknown addresses', async () => {
    const { domain, settings } = await setup();
    await settings({ clientSecret: 'provider-secret' });
    const email = `omar@${domain}`;
    const good = (nonce: string) => ({ sub: 's', email, nonce });
    expect((await signIn(email, good, true)).location).toContain(
      'error=failed',
    );
    expect((await signIn(email, () => good('wrong-nonce'))).location).toContain(
      'error=failed',
    );
    expect(
      (
        await signIn(email, (nonce) => ({
          ...good(nonce),
          email_verified: false,
        }))
      ).location,
    ).toContain('error=failed');
    // The provider asserting an address outside the verified domains.
    expect(
      (
        await signIn(email, (nonce) => ({
          ...good(nonce),
          email: 'omar@elsewhere.example',
        }))
      ).location,
    ).toContain('error=failed');
    // No organization handles this domain.
    expect(
      (await signIn('someone@unclaimed.example', good)).location,
    ).toContain('error=unavailable');
  });

  it('can require SSO for the domain, keeping owners on passwords', async () => {
    const { owner, slug, domain, settings } = await setup();
    // A password account on the domain, before SSO is required.
    const email = `sara@${domain}`;
    await fx.api.request('POST', '/signup', {
      body: { email, password: PASSWORD, displayName: 'Sara' },
    });
    await fx.api.request('POST', '/verify-email', {
      body: { token: fx.api.mailer.token(email, '/verify-email') },
    });
    const saraCookie = await fx.api.login(email);
    const session = (cookie: string) =>
      fx.api.api('GET', '/auth/session', { cookie });
    expect((await session(saraCookie)).status).toBe(200);

    expect((await settings({ requireSso: true })).status).toBe(400); // no secret stored yet
    expect(
      (await settings({ clientSecret: 'provider-secret', requireSso: true }))
        .status,
    ).toBe(200);
    // Existing sessions on the domain end; the owner's do not.
    expect((await session(saraCookie)).status).toBe(401);
    expect((await session(owner.cookie)).status).toBe(200);
    expect(
      (
        await fx.api.request('POST', '/login', {
          body: { email, password: PASSWORD },
        })
      ).status,
    ).toBe(403);
    // A wrong password still looks like any failed sign-in.
    expect(
      (
        await fx.api.request('POST', '/login', {
          body: { email, password: 'wrong password!' },
        })
      ).status,
    ).toBe(401);

    // Only owners manage SSO; settings never cross organizations.
    const admin = await fx.join(slug, owner, 'admin');
    expect(
      (await fx.call(admin, 'GET', `/organizations/${slug}/sso`)).status,
    ).toBe(403);
    const other = await fx.account('other');
    const otherSlug = await fx.organization(other);
    expect(
      (await fx.call(other, 'GET', `/organizations/${slug}/sso`)).status,
    ).toBe(404);
    expect(
      (
        await fx.call(other, 'PUT', `/organizations/${otherSlug}/sso`, {
          issuer: provider.issuer,
          clientId: 'x',
          clientSecret: 'y',
          enabled: true,
          requireSso: false,
        })
      ).status,
    ).toBe(400); // no verified domain

    expect(
      (await fx.call(owner, 'DELETE', `/organizations/${slug}/sso`)).status,
    ).toBe(204);
    expect(
      (
        await fx.api.request('POST', '/login', {
          body: { email, password: PASSWORD },
        })
      ).status,
    ).toBe(204);
  });
});
