import { describe, expect, it } from 'vitest';
import { parseAuthEnvironment } from '../packages/config/src';
import { signupRequestSchema } from '../packages/contracts/src';
import {
  digestToken,
  generateToken,
  hashPassword,
  verifyPassword,
} from '../packages/shared/src/auth';
import {
  clearedSessionCookie,
  sessionCookie,
} from '../apps/api/src/auth/cookies';

describe('password hashing', () => {
  it('produces salted Argon2id PHC strings that verify', async () => {
    const first = await hashPassword('correct horse battery');
    const second = await hashPassword('correct horse battery');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword('correct horse battery', first)).toBe(true);
    expect(await verifyPassword('correct horse batterz', first)).toBe(false);
  });

  it('treats malformed hashes as a failed match', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', '$argon2id$v=19$m=1$x$y')).toBe(
      false,
    );
  });
});

describe('tokens', () => {
  it('generates 256-bit URL-safe tokens', () => {
    const token = generateToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateToken()).not.toBe(token);
  });

  it('digests with a keyed HMAC', () => {
    const secret = 'a'.repeat(32);
    const digest = digestToken('token', secret);
    expect(digest).toHaveLength(32);
    expect(digestToken('token', secret).equals(digest)).toBe(true);
    expect(digestToken('token', 'b'.repeat(32)).equals(digest)).toBe(false);
  });
});

describe('auth environment', () => {
  const valid = {
    SESSION_SECRET: 's'.repeat(32),
    WEB_ORIGIN: 'http://localhost:3000',
  };
  it('accepts an exact origin and a long secret', () => {
    expect(parseAuthEnvironment(valid).WEB_ORIGIN).toBe(
      'http://localhost:3000',
    );
  });
  it.each([
    'http://localhost:3000/',
    'http://localhost:3000/app',
    'ftp://localhost',
  ])('rejects %s as WEB_ORIGIN', (WEB_ORIGIN) => {
    expect(() => parseAuthEnvironment({ ...valid, WEB_ORIGIN })).toThrow(
      'WEB_ORIGIN',
    );
  });
  it('rejects short secrets without echoing them', () => {
    expect(() =>
      parseAuthEnvironment({ ...valid, SESSION_SECRET: 'short-secret' }),
    ).toThrow(/^Invalid auth environment: SESSION_SECRET$/);
  });
});

describe('request validation', () => {
  it('normalizes email and rejects short passwords or extra fields', () => {
    const parsed = signupRequestSchema.parse({
      email: '  Person@Example.TEST ',
      password: 'long enough password',
      displayName: ' Person ',
    });
    expect(parsed).toEqual({
      email: 'person@example.test',
      password: 'long enough password',
      displayName: 'Person',
    });
    expect(
      signupRequestSchema.safeParse({ ...parsed, password: 'short' }).success,
    ).toBe(false);
    expect(
      signupRequestSchema.safeParse({ ...parsed, role: 'owner' }).success,
    ).toBe(false);
  });
});

describe('session cookie', () => {
  it('is HttpOnly and SameSite=Lax', () => {
    const cookie = sessionCookie('abc', 60);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=60');
    expect(clearedSessionCookie()).toContain('Max-Age=0');
  });
});
