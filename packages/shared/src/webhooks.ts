import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { BlockList, isIP } from 'node:net';

/** Webhook event types an endpoint can subscribe to (ADR-036). */
export const WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'comment.created',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * The signature header value: `v1=` and the hex HMAC-SHA256 of
 * `{timestamp}.{body}` with the endpoint secret. Receivers recompute it and
 * reject timestamps older than five minutes.
 */
export function signWebhook(
  secret: string,
  timestamp: number,
  body: string,
): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** Receiver-side check, as documented for integrators (constant time). */
export function verifyWebhook(
  secret: string,
  timestamp: number,
  body: string,
  header: string,
  now = Date.now(),
  toleranceSeconds = 300,
): boolean {
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function key(material: string): Buffer {
  return createHash('sha256').update(material).digest();
}

/** Encrypts an endpoint secret for storage (AES-256-GCM). */
export function sealSecret(secret: string, material: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(material), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
    .join(':');
}

export function openSecret(sealed: string, material: string): string {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !data)
    throw new Error('unknown secret format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(material),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// Addresses a webhook must never reach: private, loopback, link-local
// (including cloud metadata at 169.254.169.254), carrier-grade NAT,
// multicast, reserved and documentation ranges, in IPv4 and IPv6.
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['100::', 64],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** True only for publicly routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const lower = address.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses are
  // judged by the IPv4 address inside them.
  const embedded = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (embedded?.[1]) return isPublicAddress(embedded[1]);
  if (lower.startsWith('::ffff:') || lower.startsWith('64:ff9b::'))
    return false;
  return !blocked.check(address, 'ipv6');
}

/**
 * Checks an endpoint URL before saving it: https (http only when allowed for
 * development), no credentials, a hostname rather than a bare private
 * address. Addresses are checked again at delivery time after DNS lookup.
 */
export function checkWebhookUrl(
  value: string,
  options: { allowHttp?: boolean; allowedHosts?: readonly string[] } = {},
): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }
  if (
    url.protocol !== 'https:' &&
    !(options.allowHttp && url.protocol === 'http:')
  )
    return 'protocol';
  if (url.username || url.password) return 'credentials';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (options.allowedHosts?.includes(host)) return undefined;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal')
  )
    return 'address';
  if (isIP(host) && !isPublicAddress(host)) return 'address';
  return undefined;
}

/**
 * Webhook settings: `WEBHOOK_SECRET_KEY` (32+ characters) seals endpoint
 * secrets. `WEBHOOK_ALLOWED_HOSTS` and `WEBHOOK_ALLOW_HTTP` relax the
 * address and protocol rules for local development and tests and are
 * ignored in production.
 */
export interface WebhookSettings {
  material: string;
  allowHttp: boolean;
  allowedHosts: string[];
}

export function webhookSettings(
  env: Record<string, string | undefined>,
): WebhookSettings | undefined {
  const material = env.WEBHOOK_SECRET_KEY;
  if (!material || material.length < 32) return undefined;
  const production = env.NODE_ENV === 'production';
  return {
    material,
    allowHttp: !production && env.WEBHOOK_ALLOW_HTTP === 'true',
    allowedHosts: production
      ? []
      : (env.WEBHOOK_ALLOWED_HOSTS ?? '')
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
  };
}
