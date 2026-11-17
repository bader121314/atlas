import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  encryptPush,
  isPushServiceUrl,
  vapidAuthorization,
} from '../packages/shared/src/web-push';

/** What a browser does with an incoming message (RFC 8291). */
function decrypt(body: Buffer, userPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  expect(body.readUInt32BE(16)).toBe(4096);
  const idLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  const user = createECDH('prime256v1');
  user.setPrivateKey(userPrivate);
  const shared = user.computeSecret(senderPublic);
  const info = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    user.getPublicKey(),
    senderPublic,
  ]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(
    hkdfSync(
      'sha256',
      ikm,
      salt,
      Buffer.from('Content-Encoding: aes128gcm\0'),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  expect(plain.at(-1)).toBe(2);
  return plain.subarray(0, -1).toString('utf8');
}

describe('web push', () => {
  it('encrypts a message only the subscribed browser can read', () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const auth = randomBytes(16);
    const target = {
      p256dh: browser.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    };
    const message = JSON.stringify({ title: 'COAST-1 مسح الخليج', url: '/x' });
    const body = encryptPush(target, Buffer.from(message));
    expect(decrypt(body, browser.getPrivateKey(), auth)).toBe(message);
    // Fresh salt and sender key each time.
    expect(encryptPush(target, Buffer.from(message)).equals(body)).toBe(false);
    // Another browser's keys cannot open it.
    const other = createECDH('prime256v1');
    other.generateKeys();
    expect(() => decrypt(body, other.getPrivateKey(), auth)).toThrow();
    expect(() =>
      encryptPush({ p256dh: 'short', auth: target.auth }, Buffer.from('x')),
    ).toThrow();
  });

  it('signs VAPID tokens the push service can verify', () => {
    const server = createECDH('prime256v1');
    server.generateKeys();
    const keys = {
      publicKey: server.getPublicKey().toString('base64url'),
      privateKey: server.getPrivateKey().toString('base64url'),
      subject: 'mailto:ops@atlas.example',
    };
    const header = vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      0,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match?.[4]).toBe(keys.publicKey);
    const [, head = '', claims = '', signature = ''] = match ?? [];
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 12 * 3600,
      sub: 'mailto:ops@atlas.example',
    });
    const point = server.getPublicKey();
    const key = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${head}.${claims}`),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('accepts only known push services', () => {
    expect(isPushServiceUrl('https://fcm.googleapis.com/fcm/send/x')).toBe(
      true,
    );
    expect(
      isPushServiceUrl('https://wns2-by3p.notify.windows.com/w/?token=x'),
    ).toBe(true);
    expect(isPushServiceUrl('https://evil.example/fcm.googleapis.com')).toBe(
      false,
    );
    expect(isPushServiceUrl('http://fcm.googleapis.com/x')).toBe(false);
    expect(isPushServiceUrl('https://push.test/x', ['push.test'])).toBe(true);
    expect(isPushServiceUrl('http://push.test/x', ['push.test'])).toBe(false);
    expect(isPushServiceUrl('not a url')).toBe(false);
  });
});
