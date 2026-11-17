import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { DomainResolver } from '../../apps/api/src/domains/domain-resolver';
import {
  MAX_FAILED_CHECKS,
  recheckDomains,
} from '../../apps/worker/src/domains/rechecker';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
const pool = new Pool({
  connectionString: parseEnvironment(process.env).DATABASE_URL,
  max: 2,
});
const dns = new Map<string, string[]>();
beforeAll(async () => {
  fx = await startFixtures();
  const resolver = fx.api.app.get(DomainResolver, { strict: false });
  resolver.txt = async (name: string) => dns.get(name) ?? [];
});
afterAll(async () => {
  await fx.close();
  await pool.end();
});

describe('domain re-checks', () => {
  it('keeps domains whose record stays and unverifies ones missing three times', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const organizationId = (
      await fx.db.query<{ id: string }>(
        'SELECT id FROM organizations WHERE slug = $1',
        [slug],
      )
    ).rows[0]?.id;
    const path = `/organizations/${slug}/domains`;
    const add = async (domain: string) => {
      const created = (await fx.call(owner, 'POST', path, { domain })).json as {
        id: string;
        record: { name: string; value: string };
      };
      dns.set(created.record.name, [created.record.value]);
      expect(
        (await fx.call(owner, 'POST', `${path}/${created.id}/verify`)).status,
      ).toBe(200);
      return created;
    };
    const stamp = Date.now();
    const kept = await add(`kept-${stamp}.example`);
    const lost = await add(`lost-${stamp}.example`);
    dns.delete(lost.record.name);

    const run = () =>
      recheckDomains(pool, async (name) => dns.get(name) ?? [], {
        now: true,
        ...(organizationId ? { organizationId } : {}),
      });
    for (let i = 1; i < MAX_FAILED_CHECKS; i += 1)
      expect(await run()).toEqual({ checked: 2, unverified: 0 });
    // A record that reappears in time resets the count; this one does not.
    expect(await run()).toEqual({ checked: 2, unverified: 1 });
    const domains = (await fx.call(owner, 'GET', path)).json as {
      id: string;
      verified: boolean;
    }[];
    expect(domains.find((d) => d.id === kept.id)?.verified).toBe(true);
    expect(domains.find((d) => d.id === lost.id)?.verified).toBe(false);
    const audit = (
      await fx.call(
        owner,
        'GET',
        `/organizations/${slug}/audit-events?action=org.domain.unverified`,
      )
    ).json as { items: { metadata: { domain: string } }[] };
    expect(audit.items[0]?.metadata.domain).toBe(`lost-${stamp}.example`);
    // Only verified domains are checked now.
    expect(await run()).toEqual({ checked: 1, unverified: 0 });
  });
});
