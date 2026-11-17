import {
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  createCipheriv,
} from 'node:crypto';

/**
 * Web Push (ADR-060): message encryption (RFC 8291, aes128gcm per RFC 8188)
 * and VAPID authentication (RFC 8292), on node:crypto only.
 */

export interface PushTarget {
  endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url. */
  publicKey: string;
  /** The private scalar, base64url. */
  privateKey: string;
  /** Contact for the push service, such as mailto:ops@example.com. */
  subject: string;
}

const b64 = (value: string) => Buffer.from(value, 'base64url');

function expand(
  ikm: Buffer,
  salt: Buffer,
  info: Buffer,
  length: number,
): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

/**
 * Encrypts a payload for one subscription. Returns the request body: the
 * aes128gcm header (salt, record size, sender key) followed by one record.
 * `salt` and `senderKeys` are only passed by tests.
 */
export function encryptPush(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  payload: Buffer,
  options: { salt?: Buffer; senderPrivateKey?: Buffer } = {},
): Buffer {
  const userPublic = b64(target.p256dh);
  const authSecret = b64(target.auth);
  if (userPublic.length !== 65 || authSecret.length !== 16)
    throw new Error('invalid subscription keys');
  const sender = createECDH('prime256v1');
  if (options.senderPrivateKey) sender.setPrivateKey(options.senderPrivateKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const shared = sender.computeSecret(userPublic);
  const salt = options.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    userPublic,
    senderPublic,
  ]);
  const ikm = expand(shared, authSecret, keyInfo, 32);
  const cek = expand(
    ikm,
    salt,
    Buffer.from('Content-Encoding: aes128gcm\0'),
    16,
  );
  const nonce = expand(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // One record: the payload, then the 0x02 delimiter for the last record.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, body]);
}

/** The Authorization header value for a push service (VAPID, RFC 8292). */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now = Date.now(),
): string {
  const publicKey = b64(keys.publicKey);
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      // JWK needs exactly 32 bytes; some encoders drop leading zeros.
      d: Buffer.concat([Buffer.alloc(32), b64(keys.privateKey)])
        .subarray(-32)
        .toString('base64url'),
      x: publicKey.subarray(1, 33).toString('base64url'),
      y: publicKey.subarray(33, 65).toString('base64url'),
    },
  });
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${segment({ typ: 'JWT', alg: 'ES256' })}.${segment({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: keys.subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${keys.publicKey}`;
}

/** Push services the browsers use; subscriptions elsewhere are refused. */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  '.notify.windows.com',
];

export function isPushServiceUrl(
  url: string,
  extraHosts: string[] = [],
): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (parsed.protocol !== 'https:') return false;
    return (
      extraHosts.includes(host) ||
      PUSH_SERVICE_HOSTS.some((allowed) =>
        allowed.startsWith('.') ? host.endsWith(allowed) : host === allowed,
      )
    );
  } catch {
    return false;
  }
}

/** PUSH_ALLOWED_HOSTS: extra push hosts for development and tests only. */
export function pushAllowedHosts(
  env: Record<string, string | undefined>,
): string[] {
  if (env.NODE_ENV === 'production') return [];
  return (env.PUSH_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

/** VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT; push is off without them. */
export function vapidKeys(
  env: Record<string, string | undefined>,
): VapidKeys | undefined {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return undefined;
  return { publicKey, privateKey, subject };
}
