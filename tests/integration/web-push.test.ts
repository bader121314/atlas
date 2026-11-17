import {
  createDecipheriv,
  createECDH,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { vapidKeys } from '../../packages/shared/src/web-push';
import { notifyBatch } from '../../apps/worker/src/notifications/notifier';
import { pushBatch } from '../../apps/worker/src/notifications/push';
import { startFixtures } from './support/fixtures';

const server = createECDH('prime256v1');
server.generateKeys();
let fx: Awaited<ReturnType<typeof startFixtures>>;
const pool = new Pool({
  connectionString: parseEnvironment(process.env).DATABASE_URL,
  max: 2,
});
beforeAll(async () => {
  vi.stubEnv('VAPID_PUBLIC_KEY', server.getPublicKey().toString('base64url'));
  vi.stubEnv('VAPID_PRIVATE_KEY', server.getPrivateKey().toString('base64url'));
  vi.stubEnv('VAPID_SUBJECT', 'mailto:ops@atlas.example');
  vi.stubEnv('PUSH_ALLOWED_HOSTS', 'push.test');
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
  await pool.end();
});

/** A browser's side of a subscription, able to read what it receives. */
function browser(endpoint: string) {
  const keys = createECDH('prime256v1');
  keys.generateKeys();
  const auth = randomBytes(16);
  return {
    subscription: {
      endpoint,
      expirationTime: null,
      keys: {
        p256dh: keys.getPublicKey().toString('base64url'),
        auth: auth.toString('base64url'),
      },
    },
    read(body: Buffer): Record<string, string> {
      const salt = body.subarray(0, 16);
      const sender = body.subarray(21, 86);
      const record = body.subarray(86);
      const info = Buffer.concat([
        Buffer.from('WebPush: info\0'),
        keys.getPublicKey(),
        sender,
      ]);
      const ikm = Buffer.from(
        hkdfSync('sha256', keys.computeSecret(sender), auth, info, 32),
      );
      const key = (label: string, n: number) =>
        Buffer.from(
          hkdfSync(
            'sha256',
            ikm,
            salt,
            Buffer.from(`Content-Encoding: ${label}\0`),
            n,
          ),
        );
      const decipher = createDecipheriv(
        'aes-128-gcm',
        key('aes128gcm', 16),
        key('nonce', 12),
      );
      decipher.setAuthTag(record.subarray(-16));
      const plain = Buffer.concat([
        decipher.update(record.subarray(0, -16)),
        decipher.final(),
      ]);
      return JSON.parse(plain.subarray(0, -1).toString()) as Record<
        string,
        string
      >;
    },
  };
}

describe('web push', () => {
  it('delivers encrypted, signed notifications to subscribed browsers', async () => {
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    const member = await fx.join(slug, owner, 'member');
    const organizationId = (
      await fx.db.query<{ id: string }>(
        'SELECT id FROM organizations WHERE slug = $1',
        [slug],
      )
    ).rows[0]?.id;
    const base = `/organizations/${slug}/projects/PUSH`;
    await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
      key: 'PUSH',
      name: 'Push',
    });

    expect((await fx.call(member, 'GET', '/push/config')).json).toEqual({
      publicKey: server.getPublicKey().toString('base64url'),
    });
    const phone = browser(`https://push.test/${Date.now()}-phone`);
    const laptop = browser(`https://push.test/${Date.now()}-laptop`);
    expect(
      (await fx.call(member, 'POST', '/push/subscriptions', phone.subscription))
        .status,
    ).toBe(204);
    expect(
      (
        await fx.call(
          member,
          'POST',
          '/push/subscriptions',
          laptop.subscription,
        )
      ).status,
    ).toBe(204);
    // Only push services; never internal or arbitrary hosts.
    for (const endpoint of [
      'https://evil.example/x',
      'http://push.test/x',
      'https://169.254.169.254/x',
    ])
      expect(
        (
          await fx.call(member, 'POST', '/push/subscriptions', {
            ...phone.subscription,
            endpoint,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await fx.api.api('POST', '/push/subscriptions', {
          body: phone.subscription,
        })
      ).status,
    ).toBe(401);

    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Moor the barge',
      assigneeId: member.id,
    });
    await notifyBatch(pool, organizationId ? { organizationId } : {});
    const sent: {
      endpoint: string;
      headers: Record<string, string>;
      body: Buffer;
    }[] = [];
    const keys = vapidKeys(process.env);
    if (!keys) throw new Error('vapid keys missing');
    const run = (status: (endpoint: string) => number) =>
      pushBatch(
        pool,
        async (endpoint, headers, body) => {
          sent.push({ endpoint, headers, body });
          return status(endpoint);
        },
        {
          keys,
          webOrigin: 'https://atlas.test',
          extraHosts: ['push.test'],
          ...(organizationId ? { organizationId } : {}),
        },
      );
    // The laptop's subscription is gone at the push service.
    expect(
      await run((endpoint) => (endpoint.endsWith('laptop') ? 410 : 201)),
    ).toEqual({
      sent: 1,
      skipped: 0,
    });
    const toPhone = sent.find(
      (s) => s.endpoint === phone.subscription.endpoint,
    );
    expect(toPhone?.headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      ttl: '86400',
    });
    expect(toPhone?.headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(phone.read(toPhone?.body ?? Buffer.alloc(0))).toMatchObject({
      title: expect.stringMatching(/assigned PUSH-1 to you$/),
      body: 'Moor the barge',
      url: `https://atlas.test/organizations/${slug}/projects/PUSH/tasks/1`,
    });
    const left = await fx.db.query(
      'SELECT endpoint FROM push_subscriptions WHERE user_id = $1',
      [member.id],
    );
    expect(left.rows.map((r: { endpoint: string }) => r.endpoint)).toEqual([
      phone.subscription.endpoint,
    ]);

    // Nothing pending is sent twice; read or unsubscribed means skipped.
    expect(await run(() => 201)).toEqual({ sent: 0, skipped: 0 });
    expect(
      (
        await fx.call(member, 'DELETE', '/push/subscriptions', {
          endpoint: phone.subscription.endpoint,
        })
      ).status,
    ).toBe(204);
    await fx.call(owner, 'POST', `${base}/tasks`, {
      title: 'Second',
      assigneeId: member.id,
    });
    await notifyBatch(pool, organizationId ? { organizationId } : {});
    expect(await run(() => 201)).toEqual({ sent: 0, skipped: 1 });
  });
});
