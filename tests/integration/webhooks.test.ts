import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { parseEnvironment } from '../../packages/config/src';
import { verifyWebhook } from '../../packages/shared/src';
import { planBatch } from '../../apps/worker/src/webhooks/planner';
import { deliverBatch, post } from '../../apps/worker/src/webhooks/sender';
import { startFixtures } from './support/fixtures';

const MATERIAL = 'integration-webhook-key-'.padEnd(40, 'x');

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let fx: Awaited<ReturnType<typeof startFixtures>>;
let pool: Pool;
let receiver: ReturnType<typeof createServer>;
let port = 0;
const received: Received[] = [];
let answer = 200;

beforeAll(async () => {
  fx = await startFixtures();
  vi.stubEnv('WEBHOOK_SECRET_KEY', MATERIAL);
  vi.stubEnv('WEBHOOK_ALLOW_HTTP', 'true');
  vi.stubEnv('WEBHOOK_ALLOWED_HOSTS', '127.0.0.1');
  pool = new Pool({
    connectionString: parseEnvironment(process.env).DATABASE_URL,
  });
  receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => {
      received.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      response.writeHead(answer).end();
    });
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, '127.0.0.1', resolve),
  );
  port = (receiver.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  await pool.end();
  await fx.close();
});

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'HOOK',
    name: 'Hooks',
  });
  const org = await fx.db.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  const organizationId = org.rows[0]?.id ?? '';
  const hooks = `/organizations/${slug}/webhooks`;
  const plan = () => planBatch(pool, { organizationId });
  const deliver = () =>
    deliverBatch(pool, {
      material: MATERIAL,
      allowedHosts: ['127.0.0.1'],
      organizationId,
    });
  return { owner, slug, organizationId, hooks, plan, deliver };
}

describe('webhooks', () => {
  it('delivers signed events once, retries failures and replays on request', async () => {
    const { owner, slug, hooks, plan, deliver } = await setup();
    const created = await fx.call(owner, 'POST', hooks, {
      url: `http://127.0.0.1:${port}/hook`,
      events: ['task.created', 'comment.created'],
    });
    expect(created.status).toBe(201);
    const { endpoint, secret } = created.json as {
      endpoint: { id: string };
      secret: string;
    };
    expect(secret).toMatch(/^whsec_/);
    expect(
      JSON.stringify((await fx.call(owner, 'GET', hooks)).json),
    ).not.toContain(secret);

    await fx.call(owner, 'POST', `/organizations/${slug}/projects/HOOK/tasks`, {
      title: 'Wire the buoy',
    });
    await fx.call(
      owner,
      'PATCH',
      `/organizations/${slug}/projects/HOOK/tasks/1`,
      {
        version: 1,
        priority: 'high',
      },
    );
    // Only the subscribed event is planned, and only once.
    expect(await plan()).toBe(1);
    expect(await plan()).toBe(0);

    received.length = 0;
    answer = 500;
    expect(await deliver()).toEqual({ delivered: 0, failed: 1 });
    await fx.db.query(
      `UPDATE webhook_deliveries SET next_attempt_at = now() WHERE endpoint_id = $1`,
      [endpoint.id],
    );
    answer = 200;
    expect(await deliver()).toEqual({ delivered: 1, failed: 0 });
    expect(received).toHaveLength(2);

    const last = received[1];
    const body = last?.body ?? '';
    const timestamp = Number(last?.headers['x-atlas-timestamp']);
    expect(
      verifyWebhook(
        secret,
        timestamp,
        body,
        String(last?.headers['x-atlas-signature']),
      ),
    ).toBe(true);
    const payload = JSON.parse(body) as {
      id: string;
      type: string;
      task: { key: string; title: string };
    };
    expect(payload).toMatchObject({
      type: 'task.created',
      task: { key: 'HOOK-1', title: 'Wire the buoy' },
    });
    expect(last?.headers['x-atlas-event-id']).toBe(payload.id);
    expect(received[0]?.headers['x-atlas-event-id']).toBe(payload.id);

    const history = (
      await fx.call(owner, 'GET', `${hooks}/${endpoint.id}/deliveries`)
    ).json as {
      id: string;
      status: string;
      attempts: number;
      lastStatusCode: number;
    }[];
    expect(history[0]).toMatchObject({
      status: 'delivered',
      attempts: 2,
      lastStatusCode: 200,
    });

    expect(
      (
        await fx.call(
          owner,
          'POST',
          `${hooks}/${endpoint.id}/deliveries/${history[0]?.id}/replay`,
        )
      ).status,
    ).toBe(202);
    expect(await deliver()).toEqual({ delivered: 1, failed: 0 });
    expect(received.at(-1)?.headers['x-atlas-event-id']).toBe(payload.id);

    expect(
      (await fx.call(owner, 'POST', `${hooks}/${endpoint.id}/ping`)).status,
    ).toBe(202);
    await deliver();
    expect(JSON.parse(received.at(-1)?.body ?? '{}')).toMatchObject({
      type: 'webhook.ping',
    });
  });

  it('pauses an endpoint that keeps failing', async () => {
    const { owner, slug, hooks, plan, deliver } = await setup();
    const { endpoint } = (
      await fx.call(owner, 'POST', hooks, {
        url: `http://127.0.0.1:${port}/hook`,
        events: ['task.created'],
      })
    ).json as { endpoint: { id: string } };
    await fx.db.query(
      'UPDATE webhook_endpoints SET consecutive_failures = 14 WHERE id = $1',
      [endpoint.id],
    );
    await fx.call(owner, 'POST', `/organizations/${slug}/projects/HOOK/tasks`, {
      title: 'One',
    });
    await plan();
    answer = 503;
    await deliver();
    answer = 200;
    const listed = (await fx.call(owner, 'GET', hooks)).json as {
      status: string;
    }[];
    expect(listed[0]?.status).toBe('paused');
    await fx.db.query(
      `UPDATE webhook_deliveries SET next_attempt_at = now() WHERE endpoint_id = $1`,
      [endpoint.id],
    );
    expect(await deliver()).toEqual({ delivered: 0, failed: 0 });
    // Re-activating resets the failure count.
    const resumed = (
      await fx.call(owner, 'PATCH', `${hooks}/${endpoint.id}`, {
        status: 'active',
      })
    ).json as {
      consecutiveFailures: number;
    };
    expect(resumed.consecutiveFailures).toBe(0);
  });

  it('refuses private destinations, before saving and when sending', async () => {
    const { owner, hooks } = await setup();
    for (const url of [
      'https://10.0.0.5/hook',
      'https://localhost/hook',
      'https://169.254.169.254/latest',
    ]) {
      expect(
        (await fx.call(owner, 'POST', hooks, { url, events: ['task.created'] }))
          .status,
      ).toBe(400);
    }
    received.length = 0;
    // "localhost" resolves to a loopback address: blocked after DNS lookup.
    expect(
      await post(
        `http://localhost:${port}/hook`,
        '{}',
        {},
        { allowedHosts: [] },
      ),
    ).toEqual({
      ok: false,
      error: 'blocked',
    });
    expect(
      await post(
        `http://127.0.0.1:${port}/hook`,
        '{}',
        {},
        { allowedHosts: [] },
      ),
    ).toEqual({
      ok: false,
      error: 'blocked',
    });
    expect(received).toHaveLength(0);
  });

  it('is limited to owners and admins, and needs a configured key', async () => {
    const { owner, slug, hooks } = await setup();
    const member = await fx.join(slug, owner, 'member');
    expect((await fx.call(member, 'GET', hooks)).status).toBe(403);
    vi.stubEnv('WEBHOOK_SECRET_KEY', '');
    expect(
      (
        await fx.call(owner, 'POST', hooks, {
          url: `http://127.0.0.1:${port}/x`,
          events: ['task.created'],
        })
      ).status,
    ).toBe(503);
    vi.stubEnv('WEBHOOK_SECRET_KEY', MATERIAL);
  });
});
