import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { parseEnvironment } from '../../packages/config/src';
import { dispatchBatch } from '../../apps/worker/src/outbox/dispatcher';
import { startAuthApp } from './support/auth-app';
import { startFixtures } from './support/fixtures';
import type { Account } from './support/fixtures';

let fx: Awaited<ReturnType<typeof startFixtures>>;
let second: Awaited<ReturnType<typeof startAuthApp>>;
let pool: Pool;
let publisher: ReturnType<typeof createClient>;

beforeAll(async () => {
  vi.stubEnv('EVENT_STREAM_REVALIDATE_MS', '200');
  fx = await startFixtures();
  // A second API instance shares the database and Redis.
  second = await startAuthApp();
  const env = parseEnvironment(process.env);
  pool = new Pool({ connectionString: env.DATABASE_URL });
  publisher = createClient({ url: env.REDIS_URL });
  await publisher.connect();
});
afterAll(async () => {
  publisher.destroy();
  await pool.end();
  await second.close();
  await fx.close();
});

interface Frame {
  event: string;
  id?: string;
  data: Record<string, unknown>;
}

/** Opens an event stream and collects its frames until closed. */
async function openStream(
  who: Account,
  path: string,
  options: { lastEventId?: string; instance?: typeof second } = {},
) {
  const instance = options.instance ?? fx.api;
  const response = await instance.api('GET', path, {
    cookie: who.cookie,
    headers: options.lastEventId
      ? { 'last-event-id': options.lastEventId }
      : {},
  });
  const frames: Frame[] = [];
  let ended = false;
  if (response.status === 200 && response.body) {
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    void (async () => {
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let index = buffer.indexOf('\n\n');
          while (index >= 0) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const lines = Object.fromEntries(
              block
                .split('\n')
                .filter((line) => !line.startsWith(':') && line.includes(': '))
                .map((line) => [
                  line.slice(0, line.indexOf(': ')),
                  line.slice(line.indexOf(': ') + 2),
                ]),
            ) as Record<string, string>;
            if (lines.event) {
              frames.push({
                event: lines.event,
                ...(lines.id ? { id: lines.id } : {}),
                data: JSON.parse(lines.data ?? '{}') as Record<string, unknown>,
              });
            }
            index = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // Cancelled by the test.
      }
      ended = true;
    })();
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    frames,
    ended: () => ended,
    close: () => response.body?.cancel().catch(() => undefined),
    async until(predicate: (frames: Frame[]) => boolean, timeout = 5000) {
      const start = Date.now();
      while (!predicate(frames)) {
        if (Date.now() - start > timeout) {
          throw new Error(`timed out; frames: ${JSON.stringify(frames)}`);
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    },
  };
}

async function setup() {
  const owner = await fx.account('owner');
  const slug = await fx.organization(owner);
  await fx.call(owner, 'POST', `/organizations/${slug}/projects`, {
    key: 'LIVE',
    name: 'Live',
  });
  const org = await fx.db.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  const organizationId = org.rows[0]?.id ?? '';
  const base = `/organizations/${slug}/projects/LIVE`;
  const dispatch = () =>
    dispatchBatch(pool, (c, m) => publisher.publish(c, m), { organizationId });
  return { owner, slug, base, organizationId, dispatch };
}

const tasks = (frames: Frame[]) => frames.filter((f) => f.event === 'task');

describe('project event stream', () => {
  it('streams committed task events to every API instance', async () => {
    const { owner, base, dispatch } = await setup();
    const one = await openStream(owner, `${base}/events`);
    const two = await openStream(owner, `${base}/events`, { instance: second });
    expect(one.status).toBe(200);
    expect(one.contentType).toContain('text/event-stream');
    await one.until((f) => f.some((x) => x.event === 'ready'));
    await two.until((f) => f.some((x) => x.event === 'ready'));

    const created = (
      await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Live one' })
    ).json as {
      id: string;
    };
    await dispatch();
    for (const stream of [one, two]) {
      await stream.until((f) => tasks(f).length === 1);
      expect(tasks(stream.frames)[0]?.data).toMatchObject({
        type: 'task.created',
        taskId: created.id,
        version: 1,
        actorUserId: owner.id,
      });
      // The envelope never carries task content.
      expect(JSON.stringify(stream.frames)).not.toContain('Live one');
      await stream.close();
    }
  });

  it('drops duplicate deliveries of the same event', async () => {
    const { owner, base, organizationId, dispatch } = await setup();
    const stream = await openStream(owner, `${base}/events`);
    await stream.until((f) => f.some((x) => x.event === 'ready'));
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Once' });
    await dispatch();
    await stream.until((f) => tasks(f).length === 1);
    const event = tasks(stream.frames)[0]?.data ?? {};
    await publisher.publish(
      `atlas:events:${organizationId}:${String(event.projectId)}`,
      JSON.stringify(event),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(tasks(stream.frames)).toHaveLength(1);
    await stream.close();
  });

  it('replays missed events after Last-Event-ID, or asks for a resync', async () => {
    const { owner, base, organizationId, dispatch } = await setup();
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'First' });
    await dispatch();
    const first = await fx.db.query<{ id: string }>(
      `SELECT o.id FROM outbox_events o JOIN tasks t ON t.id = o.aggregate_id
       WHERE o.organization_id = $1 AND o.published_at IS NOT NULL`,
      [organizationId],
    );
    const lastEventId = first.rows[0]?.id ?? '';
    // Two changes happen while the browser is away.
    await fx.call(owner, 'POST', `${base}/tasks`, { title: 'Second' });
    await fx.call(owner, 'PATCH', `${base}/tasks/1`, {
      version: 1,
      priority: 'high',
    });
    await dispatch();

    const back = await openStream(owner, `${base}/events`, { lastEventId });
    await back.until((f) => f.some((x) => x.event === 'ready'));
    expect(tasks(back.frames).map((f) => f.data.type)).toEqual([
      'task.created',
      'task.updated',
    ]);
    expect(back.frames.some((f) => f.id === lastEventId)).toBe(false);
    await back.close();

    const unknown = await openStream(owner, `${base}/events`, {
      lastEventId: '00000000-0000-4000-8000-000000000000',
    });
    await unknown.until((f) => f.some((x) => x.event === 'ready'));
    expect(unknown.frames[0]?.event).toBe('resync');
    await unknown.close();
  });

  it('refuses outsiders and closes the stream when access is lost', async () => {
    const { owner, slug, base } = await setup();
    const outsider = await fx.account('outsider');
    expect((await openStream(outsider, `${base}/events`)).status).toBe(404);
    expect((await fx.api.api('GET', `${base}/events`, {})).status).toBe(401);

    const member = await fx.join(slug, owner, 'member');
    const stream = await openStream(member, `${base}/events`);
    await stream.until((f) => f.some((x) => x.event === 'ready'));
    expect(
      (
        await fx.call(
          owner,
          'DELETE',
          `/organizations/${slug}/members/${member.id}`,
        )
      ).status,
    ).toBe(204);
    await stream.until((f) => f.some((x) => x.event === 'revoked'));
    await stream.until(() => stream.ended());
  });

  it('closes the stream when a project stops being visible to the reader', async () => {
    const { owner, slug, base } = await setup();
    const member = await fx.join(slug, owner, 'member');
    const stream = await openStream(member, `${base}/events`);
    await stream.until((f) => f.some((x) => x.event === 'ready'));
    await fx.call(owner, 'PATCH', `/organizations/${slug}/projects/LIVE`, {
      version: 1,
      visibility: 'private',
    });
    await stream.until((f) => f.some((x) => x.event === 'revoked'));
    await stream.until(() => stream.ended());
    // The owner, a manager of every project, keeps streaming.
    const kept = await openStream(owner, `${base}/events`);
    await kept.until((f) => f.some((x) => x.event === 'ready'));
    await kept.close();
  });
});
