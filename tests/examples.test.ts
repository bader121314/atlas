import { describe, expect, it } from 'vitest';
import { signWebhook } from '../packages/shared/src';
// @ts-expect-error plain JavaScript example without type declarations
import { AtlasClient } from '../examples/atlas-client.mjs';
// @ts-expect-error plain JavaScript example without type declarations
import { verifyAtlasSignature } from '../examples/webhook-receiver.mjs';

describe('examples', () => {
  it('the receiver sample accepts Atlas signatures and rejects others', () => {
    const now = Date.now();
    const timestamp = Math.floor(now / 1000);
    const body = '{"id":"e1","type":"task.created"}';
    const headers = {
      'x-atlas-timestamp': String(timestamp),
      'x-atlas-signature': signWebhook('whsec_x', timestamp, body),
    };
    expect(verifyAtlasSignature('whsec_x', headers, body, now)).toBe(true);
    expect(verifyAtlasSignature('whsec_y', headers, body, now)).toBe(false);
    expect(verifyAtlasSignature('whsec_x', headers, `${body} `, now)).toBe(
      false,
    );
    expect(verifyAtlasSignature('whsec_x', headers, body, now + 600_000)).toBe(
      false,
    );
  });

  it('the client sample sends the token and follows pagination', async () => {
    const calls: string[] = [];
    const pages = [
      { tasks: [{ key: 'NW-1' }], nextCursor: 1 },
      { tasks: [{ key: 'NW-2' }], nextCursor: null },
    ];
    const fakeFetch = async (
      url: string,
      init: { headers: Record<string, string> },
    ) => {
      calls.push(`${url} ${init.headers.authorization}`);
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    };
    const client = new AtlasClient({
      baseUrl: 'https://atlas.test/api/',
      token: 'atl_t',
      fetch: fakeFetch,
    });
    const keys: string[] = [];
    for await (const task of client.tasks('org', 'NW'))
      keys.push((task as { key: string }).key);
    expect(keys).toEqual(['NW-1', 'NW-2']);
    expect(calls[0]).toBe(
      'https://atlas.test/api/organizations/org/projects/NW/tasks?limit=100 Bearer atl_t',
    );
    expect(calls[1]).toContain('after=1');
  });
});
