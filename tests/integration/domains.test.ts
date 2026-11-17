import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainResolver } from '../../apps/api/src/domains/domain-resolver';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
const dns = new Map<string, string[]>();
beforeAll(async () => {
  fx = await startFixtures();
  // Stand-in DNS: the test publishes TXT records here.
  const resolver = fx.api.app.get(DomainResolver, { strict: false });
  resolver.txt = async (name: string) => dns.get(name) ?? [];
});
afterAll(async () => {
  await fx.close();
});

interface Domain {
  id: string;
  domain: string;
  verified: boolean;
  record: { name: string; value: string };
}

describe('verified domains', () => {
  it('verifies a domain by DNS, once per domain, and limits provisioning to it', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const name = `harbour-${Date.now()}.example`;
    const path = `/organizations/${slug}/domains`;

    const added = await fx.call(owner, 'POST', path, {
      domain: name.toUpperCase(),
    });
    expect(added.status).toBe(201);
    const domain = added.json as Domain;
    expect(domain).toMatchObject({ domain: name, verified: false });
    expect(domain.record.name).toBe(`_atlas-challenge.${name}`);
    expect((await fx.call(owner, 'POST', path, { domain: name })).status).toBe(
      409,
    );
    expect(
      (await fx.call(owner, 'POST', path, { domain: 'not a domain' })).status,
    ).toBe(400);

    // Without the record, verification fails; with it, it succeeds.
    expect(
      (await fx.call(owner, 'POST', `${path}/${domain.id}/verify`)).status,
    ).toBe(409);
    dns.set(domain.record.name, ['unrelated', domain.record.value]);
    const verified = await fx.call(
      owner,
      'POST',
      `${path}/${domain.id}/verify`,
    );
    expect(verified.status).toBe(200);
    expect((verified.json as Domain).verified).toBe(true);

    // Another organization can add it but never verify it while it is taken.
    const rival = await fx.account('rival');
    const rivalSlug = await fx.organization(rival);
    const theirs = (
      await fx.call(rival, 'POST', `/organizations/${rivalSlug}/domains`, {
        domain: name,
      })
    ).json as Domain;
    dns.set(theirs.record.name, [domain.record.value, theirs.record.value]);
    expect(
      (
        await fx.call(
          rival,
          'POST',
          `/organizations/${rivalSlug}/domains/${theirs.id}/verify`,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await fx.call(
          rival,
          'DELETE',
          `/organizations/${slug}/domains/${domain.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fx.call(
          rival,
          'DELETE',
          `/organizations/${rivalSlug}/domains/${domain.id}`,
        )
      ).status,
    ).toBe(404);

    // Provisioning is now limited to the verified domain.
    const secret = (
      (await fx.call(owner, 'POST', `/organizations/${slug}/scim-tokens`))
        .json as { secret: string }
    ).secret;
    const provision = (userName: string) =>
      fetch(`${fx.api.root}/scim/v2/Users`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/scim+json',
        },
        body: JSON.stringify({ userName }),
      });
    expect(
      (await provision(`someone@elsewhere-${Date.now()}.example`)).status,
    ).toBe(400);
    expect((await provision(`noura@${name}`)).status).toBe(201);

    // Only owners manage domains.
    const admin = await fx.join(slug, owner, 'admin');
    expect((await fx.call(admin, 'GET', path)).status).toBe(403);
    expect(
      (await fx.call(owner, 'DELETE', `${path}/${domain.id}`)).status,
    ).toBe(204);
    expect((await fx.call(owner, 'GET', path)).json).toEqual([]);
  });
});
