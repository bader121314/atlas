import { Registry } from '@atlas/shared';

/** The API's metrics (ADR-041). */
export const apiMetrics = new Registry();

const requests = apiMetrics.counter(
  'atlas_http_requests_total',
  'HTTP requests by method, route pattern and status class.',
);
const duration = apiMetrics.histogram(
  'atlas_http_request_duration_seconds',
  'HTTP request duration by method and route pattern.',
);

interface MetricRequest {
  method: string;
  route?: { path?: string };
}

interface MetricResponse {
  statusCode: number;
  on(event: 'finish', listener: () => void): void;
}

/**
 * Express middleware recording each request. Routes are labeled by their
 * pattern (`/v1/organizations/:slug/...`), never the concrete path, so
 * slugs and ids do not become label values.
 */
export function httpMetrics() {
  return (
    request: MetricRequest,
    response: MetricResponse,
    next: () => void,
  ): void => {
    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const route = request.route?.path ?? 'unmatched';
      const status = `${Math.floor(response.statusCode / 100)}xx`;
      requests.inc({ method: request.method, route, status });
      duration.observe(
        { method: request.method, route },
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    });
    next();
  };
}
