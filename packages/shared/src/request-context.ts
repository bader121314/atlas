import { randomUUID } from 'node:crypto';

const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * The request id to use: the caller's `X-Request-Id` when it looks like an
 * id (so a proxy's id carries through), otherwise a new UUID. Anything else
 * is replaced, so ids are safe to log and return.
 */
export function requestIdFrom(value: string | string[] | undefined): string {
  const given = Array.isArray(value) ? value[0] : value;
  return given && VALID_ID.test(given) ? given : randomUUID();
}

/**
 * Express `trust proxy` setting from TRUST_PROXY: unset or "false" trusts
 * no proxy (the socket address is the client), a number trusts that many
 * hops, and "loopback" trusts a proxy on the same machine (the web server).
 */
export function trustProxySetting(
  value: string | undefined,
): boolean | number | string {
  if (!value || value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (['loopback', 'linklocal', 'uniquelocal'].includes(value)) return value;
  throw new Error('Invalid TRUST_PROXY: use false, a hop count, or loopback');
}

interface LogRequest {
  method: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  requestId?: string;
  auth?: { user: { id: string } };
}

interface LogResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: 'finish', listener: () => void): void;
}

/**
 * Express middleware: assigns the request id (echoed as `X-Request-Id`) and
 * writes one JSON line per request with method, path without its query,
 * status, duration and user id. Query strings and bodies are never logged.
 */
export function requestLogging(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  enabled = process.env.NODE_ENV !== 'test',
) {
  return (
    request: LogRequest,
    response: LogResponse,
    next: () => void,
  ): void => {
    const requestId = requestIdFrom(request.headers['x-request-id']);
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    if (enabled) {
      response.on('finish', () => {
        write(
          JSON.stringify({
            time: new Date().toISOString(),
            level: response.statusCode >= 500 ? 'error' : 'info',
            msg: 'request',
            requestId,
            method: request.method,
            path: (request.originalUrl ?? request.url ?? '').split('?')[0],
            status: response.statusCode,
            durationMs:
              Number((process.hrtime.bigint() - started) / 1000n) / 1000,
            userId: request.auth?.user.id ?? null,
          }),
        );
      });
    }
    next();
  };
}
