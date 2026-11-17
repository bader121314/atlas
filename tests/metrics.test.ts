import { describe, expect, it } from 'vitest';
import { Registry, metricsAuthorized } from '../packages/shared/src';

describe('metrics registry', () => {
  it('renders counters, cumulative histograms and gauges in Prometheus text format', () => {
    const registry = new Registry();
    const counter = registry.counter('atlas_test_total', 'A test counter.');
    counter.inc({ route: '/v1/x', status: '2xx' });
    counter.inc({ route: '/v1/x', status: '2xx' }, 2);
    const histogram = registry.histogram(
      'atlas_test_seconds',
      'A test histogram.',
      [0.1, 1],
    );
    histogram.observe({ job: 'a' }, 0.05);
    histogram.observe({ job: 'a' }, 0.5);
    const text = registry.render([
      {
        name: 'atlas_test_gauge',
        help: 'A gauge.',
        values: [{ labels: { queue: 'q"1' }, value: 4 }],
      },
    ]);
    expect(text).toContain('# TYPE atlas_test_total counter');
    expect(text).toContain('atlas_test_total{route="/v1/x",status="2xx"} 3');
    expect(text).toContain('atlas_test_seconds_bucket{job="a",le="0.1"} 1');
    expect(text).toContain('atlas_test_seconds_bucket{job="a",le="1"} 2');
    expect(text).toContain('atlas_test_seconds_bucket{job="a",le="+Inf"} 2');
    expect(text).toContain('atlas_test_seconds_count{job="a"} 2');
    expect(text).toContain('atlas_test_gauge{queue="q\\"1"} 4');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('only opens to the configured token', () => {
    const token = 'metrics-token-0123456789';
    expect(metricsAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(metricsAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(metricsAuthorized(undefined, token)).toBe(false);
    expect(metricsAuthorized('Bearer short', 'short')).toBe(false);
    expect(metricsAuthorized(`Bearer ${token}`, undefined)).toBe(false);
  });
});
