import { describe, expect, it } from 'vitest';
import {
  requestIdFrom,
  requestLogging,
  trustProxySetting,
} from '../packages/shared/src';

describe('request ids', () => {
  it('keeps a well-formed incoming id and replaces anything else', () => {
    expect(requestIdFrom('req_123456789')).toBe('req_123456789');
    expect(requestIdFrom(['abcdefgh-1', 'other'])).toBe('abcdefgh-1');
    for (const bad of [
      undefined,
      'short',
      'has space in it',
      'x'.repeat(200),
      'line\nbreak12',
    ]) {
      expect(requestIdFrom(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('reads TRUST_PROXY strictly', () => {
    expect(trustProxySetting(undefined)).toBe(false);
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('1')).toBe(1);
    expect(trustProxySetting('loopback')).toBe('loopback');
    expect(() => trustProxySetting('*')).toThrow();
  });

  it('logs one JSON line per request without the query string', () => {
    const lines: string[] = [];
    const headers: Record<string, string> = {};
    let finish = () => undefined as void;
    const request = {
      method: 'POST',
      originalUrl: '/v1/auth/verify-email?token=secret-value',
      headers: { 'x-request-id': 'req_abcdefgh' },
      auth: { user: { id: 'u1' } },
    } as Parameters<ReturnType<typeof requestLogging>>[0];
    const response = {
      statusCode: 204,
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      on: (_event: 'finish', listener: () => void) => {
        finish = listener;
      },
    };
    let called = false;
    requestLogging((line) => lines.push(line), true)(request, response, () => {
      called = true;
    });
    finish();
    expect(called).toBe(true);
    expect(headers['X-Request-Id']).toBe('req_abcdefgh');
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      msg: 'request',
      requestId: 'req_abcdefgh',
      method: 'POST',
      path: '/v1/auth/verify-email',
      status: 204,
      userId: 'u1',
    });
    expect(lines[0]).not.toContain('secret-value');
  });
});
