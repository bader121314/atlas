import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress } from '@atlas/shared';

/** How the API may reach identity providers (ADR-058). */
export interface OutboundRules {
  allowHttp: boolean;
  allowedHosts: string[];
}

export class OidcError extends Error {}

/**
 * Fetches JSON from an identity provider: https only, public addresses only
 * (as for webhooks, ADR-036), no redirects, five-second timeout, 1 MB cap.
 * Development and tests may allow http and named local hosts.
 */
export async function fetchJson(
  url: string,
  rules: OutboundRules,
  init: RequestInit = {},
): Promise<unknown> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OidcError('invalid url');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const allowed = rules.allowedHosts.includes(host);
  if (
    parsed.protocol !== 'https:' &&
    !(rules.allowHttp && parsed.protocol === 'http:')
  )
    throw new OidcError('https required');
  if (!allowed) {
    const addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true }).catch(() => []);
    if (
      addresses.length === 0 ||
      addresses.some((a) => !isPublicAddress(a.address))
    )
      throw new OidcError('address not allowed');
  }
  const response = await fetch(parsed, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    throw new OidcError('unreachable');
  });
  const text = await response.text();
  if (text.length > 1_000_000) throw new OidcError('response too large');
  if (!response.ok) throw new OidcError(`status ${response.status}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OidcError('not json');
  }
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export async function discover(
  issuer: string,
  rules: OutboundRules,
): Promise<Discovery> {
  const doc = (await fetchJson(
    `${issuer}/.well-known/openid-configuration`,
    rules,
  )) as Partial<Discovery> | undefined;
  if (
    !doc ||
    doc.issuer?.replace(/\/+$/, '') !== issuer ||
    typeof doc.authorization_endpoint !== 'string' ||
    typeof doc.token_endpoint !== 'string' ||
    typeof doc.jwks_uri !== 'string'
  )
    throw new OidcError('invalid discovery document');
  return doc as Discovery;
}

export function randomValue(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** PKCE S256 challenge for a verifier. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface IdClaims {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8'),
    );
    if (typeof value === 'object' && value !== null)
      return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new OidcError('malformed token');
}

/**
 * Verifies an ID token: RS256 or ES256 signature from the provider's keys,
 * issuer, audience, expiry (one minute of clock skew), nonce, and an email
 * the provider has not marked unverified.
 */
export function verifyIdToken(
  token: string,
  keys: (JsonWebKey & { kid?: string; alg?: string; use?: string })[],
  expected: { issuer: string; audience: string; nonce: string; now?: number },
): IdClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('malformed token');
  const [head = '', body = '', sig = ''] = parts;
  const header = decodeSegment(head);
  const alg = header.alg;
  if (alg !== 'RS256' && alg !== 'ES256')
    throw new OidcError('unsupported algorithm');
  const candidates = keys.filter(
    (k) =>
      (header.kid === undefined || k.kid === header.kid) &&
      (k.use === undefined || k.use === 'sig') &&
      k.kty === (alg === 'RS256' ? 'RSA' : 'EC'),
  );
  const data = Buffer.from(`${head}.${body}`);
  const signature = Buffer.from(sig, 'base64url');
  const valid = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      return alg === 'RS256'
        ? verify('sha256', data, key, signature)
        : verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
    } catch {
      return false;
    }
  });
  if (!valid) throw new OidcError('bad signature');
  const claims = decodeSegment(body);
  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  const audience = claims.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  if (String(claims.iss ?? '').replace(/\/+$/, '') !== expected.issuer)
    throw new OidcError('wrong issuer');
  if (!audiences.includes(expected.audience))
    throw new OidcError('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp + 60 < now)
    throw new OidcError('expired');
  if (typeof claims.iat === 'number' && claims.iat - 60 > now)
    throw new OidcError('issued in the future');
  if (claims.nonce !== expected.nonce) throw new OidcError('wrong nonce');
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string')
    throw new OidcError('missing claims');
  // Some providers (Entra ID) omit email_verified; the address must still be
  // on one of the organization's verified domains, checked by the caller.
  if (claims.email_verified === false)
    throw new OidcError('email not verified');
  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    email_verified: true,
    ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
  };
}
