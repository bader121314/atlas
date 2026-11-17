import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { createClient } from 'redis';
import { parseEnvironment } from '../../packages/config/src';
import { projectEventSchema } from '../../packages/contracts/src';
import { dispatchBatch } from '../../apps/worker/src/outbox/dispatcher';
import { startFixtures } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
let pool: Pool;
beforeAll(async () => {
  fx = await startFixtures();
  pool = new Pool({
    connectionString: parseEnvironment(process.env).DATABASE_URL,
  });
});
afterAll(async () => {
  await pool.end();
  await fx.close();
});

async function projectWithTasks(count: number) {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'OUT',
    name: 'Outbox',
  });
  for (let i = 0; i < count; i += 1) {
    await fx.call(owner, 'POST', `/organizations/${slug}/projects/OUT/tasks`, {
      title: `T${i}`,
    });
  }
  const org = await fx.db.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  return { organizationId: org.rows[0]?.id ?? '', owner, slug };
}

function collector() {
  const messages: { channel: string; message: string }[] = [];
  return {
    messages,
    publish: async (channel: string, message: string) => {
      messages.push({ channel, message });
    },
  };
}

describe('outbox dispatcher', () => {
  it('publishes committed events once, in order, and marks them published', async () => {
    const { organizationId } = await projectWithTasks(3);
    const sink = collector();
    const result = await dispatchBatch(pool, sink.publish, { organizationId });
    expect(result).toEqual({ published: 3, failed: 0 });
    const events = sink.messages.map((m) =>
      projectEventSchema.parse(JSON.parse(m.message)),
    );
    expect(events.map((e) => e.type)).toEqual([
      'task.created',
      'task.created',
      'task.created',
    ]);
    expect(new Set(sink.messages.map((m) => m.channel)).size).toBe(1);
    expect(sink.messages[0]?.channel).toBe(
      `atlas:events:${organizationId}:${events[0]?.projectId}`,
    );
    expect(await dispatchBatch(pool, sink.publish, { organizationId })).toEqual(
      {
        published: 0,
        failed: 0,
      },
    );
  });

  it('never publishes an event whose transaction has not committed', async () => {
    const { organizationId } = await projectWithTasks(0);
    const writer = new Client({
      connectionString: parseEnvironment(process.env).DATABASE_URL,
    });
    await writer.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO outbox_events (organization_id, project_id, aggregate_type, aggregate_id,
           aggregate_version, event_type, payload)
         VALUES ($1, gen_random_uuid(), 'task', gen_random_uuid(), 1, 'task.created', '{}')`,
        [organizationId],
      );
      const sink = collector();
      expect(
        (await dispatchBatch(pool, sink.publish, { organizationId })).published,
      ).toBe(0);
      await writer.query('COMMIT');
      expect(
        (await dispatchBatch(pool, sink.publish, { organizationId })).published,
      ).toBe(1);
    } finally {
      await writer.end();
    }
  });

  it('lets two dispatchers share the work without duplicates', async () => {
    const { organizationId } = await projectWithTasks(6);
    const sink = collector();
    const slow = async (channel: string, message: string) => {
      await new Promise((r) => setTimeout(r, 20));
      await sink.publish(channel, message);
    };
    const runs = await Promise.all([
      dispatchBatch(pool, slow, { organizationId, batchSize: 3 }),
      dispatchBatch(pool, slow, { organizationId, batchSize: 3 }),
    ]);
    expect(runs.reduce((n, r) => n + r.published, 0)).toBe(6);
    const ids = sink.messages.map(
      (m) => (JSON.parse(m.message) as { id: string }).id,
    );
    expect(new Set(ids).size).toBe(6);
  });

  it('records a failed attempt, waits, then delivers', async () => {
    const { organizationId } = await projectWithTasks(2);
    const failing = async () => {
      throw new Error('redis down');
    };
    expect(await dispatchBatch(pool, failing, { organizationId })).toEqual({
      published: 0,
      failed: 1,
    });
    const rows = await fx.db.query<{ attempt_count: number; waiting: boolean }>(
      `SELECT attempt_count, next_attempt_at > now() AS waiting FROM outbox_events
       WHERE organization_id = $1 ORDER BY occurred_at, id`,
      [organizationId],
    );
    expect(rows.rows[0]).toEqual({ attempt_count: 1, waiting: true });
    // Other events continue while the failed one waits.
    const sink = collector();
    expect(
      (await dispatchBatch(pool, sink.publish, { organizationId })).published,
    ).toBe(1);
    await fx.db.query(
      'UPDATE outbox_events SET next_attempt_at = now() WHERE organization_id = $1',
      [organizationId],
    );
    expect(
      (await dispatchBatch(pool, sink.publish, { organizationId })).published,
    ).toBe(1);
  });

  it('delivers through Redis pub/sub to a subscriber', async () => {
    const { organizationId } = await projectWithTasks(1);
    const url = parseEnvironment(process.env).REDIS_URL;
    const publisher = createClient({ url });
    const subscriber = publisher.duplicate();
    await Promise.all([publisher.connect(), subscriber.connect()]);
    try {
      const received = new Promise<string>((resolve) => {
        void subscriber.pSubscribe(
          `atlas:events:${organizationId}:*`,
          (message) => resolve(message),
        );
      });
      await new Promise((r) => setTimeout(r, 50));
      await dispatchBatch(pool, (c, m) => publisher.publish(c, m), {
        organizationId,
      });
      expect(projectEventSchema.parse(JSON.parse(await received)).type).toBe(
        'task.created',
      );
    } finally {
      publisher.destroy();
      subscriber.destroy();
    }
  });
});
