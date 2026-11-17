import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  createNonce,
  storageOrigin,
} from '../apps/web/lib/csp';

describe('content security policy (ADR-064)', () => {
  const policy = contentSecurityPolicy({
    nonce: 'abc123',
    storageOrigin: 'https://files.example.com',
  });
  const directive = (name: string) =>
    policy
      .split('; ')
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1);

  it('runs only scripts with the nonce, never inline or eval', () => {
    expect(directive('script-src')).toBe(
      "'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(directive('script-src')).not.toContain('unsafe');
  });

  it('allows eval only in development', () => {
    const dev = contentSecurityPolicy({ nonce: 'n', development: true });
    expect(dev).toContain("'unsafe-eval'");
  });

  it('keeps the other protections', () => {
    expect(directive('default-src')).toBe("'self'");
    expect(directive('object-src')).toBe("'none'");
    expect(directive('frame-ancestors')).toBe("'none'");
    expect(directive('base-uri')).toBe("'self'");
    expect(directive('connect-src')).toBe("'self' https://files.example.com");
  });

  it('makes a different 128-bit nonce each time', () => {
    const nonces = new Set(Array.from({ length: 100 }, createNonce));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });

  it('reads the storage origin from the environment', () => {
    expect(storageOrigin({ STORAGE_ENDPOINT: 'http://minio:9000/x' })).toBe(
      'http://minio:9000',
    );
    expect(
      storageOrigin({
        STORAGE_ENDPOINT: 'http://minio:9000',
        STORAGE_PUBLIC_ORIGIN: 'https://files.example.com',
      }),
    ).toBe('https://files.example.com');
    expect(storageOrigin({})).toBe('');
  });
});
