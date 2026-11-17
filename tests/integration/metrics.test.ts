import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startFixtures } from './support/fixtures';

const TOKEN = 'integration-metrics-token-1234';
let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  await fx.close();
});

describe('metrics endpoint', () => {
  it('is hidden without the token and reports requests and backlogs with it', async () => {
    vi.stubEnv('METRICS_TOKEN', TOKEN);
    const owner = await fx.account('owner');
    const slug = await fx.organization(owner);
    await fx.call(owner, 'GET', `/organizations/${slug}`);

    expect((await fx.api.api('GET', '/metrics')).status).toBe(404);
    expect(
      (
        await fx.api.api('GET', '/metrics', {
          headers: { authorization: 'Bearer wrong' },
        })
      ).status,
    ).toBe(404);
    const response = await fx.api.api('GET', '/metrics', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const text = await response.text();
    expect(text).toMatch(
      /atlas_http_requests_total\{method="GET",route="\/v1\/organizations\/:slug",status="2xx"\} \d+/,
    );
    expect(text).not.toContain(slug);
    expect(text).toMatch(/atlas_outbox_lag_seconds \d/);
    expect(text).toContain('atlas_worker_backlog{queue="webhooks"}');
    expect(text).toContain('atlas_http_request_duration_seconds_bucket');
  });
});
