import { argon2, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Argon2id via Node's built-in implementation (Node >= 24.7). Parameters follow
// the OWASP Password Storage Cheat Sheet baseline (19 MiB, 2 passes, 1 lane).
export const PASSWORD_PARAMETERS = {
  memory: 19456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;
const SALT_BYTES = 16;
const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface Argon2Settings {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
}

function derive(
  password: string,
  salt: Buffer,
  settings: Argon2Settings,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      { message: password, nonce: salt, ...settings },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

function encode(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}

/** Returns a PHC-format Argon2id hash with a random per-password salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, PASSWORD_PARAMETERS);
  const { memory, passes, parallelism } = PASSWORD_PARAMETERS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${encode(salt)}$${encode(key)}`;
}

/** Constant-time comparison; malformed hashes verify as false. */
export async function verifyPassword(
  password: string,
  phc: string,
): Promise<boolean> {
  const match = PHC_PATTERN.exec(phc);
  if (!match) return false;
  const [, memory, passes, parallelism, salt, expected] = match;
  const expectedKey = Buffer.from(expected ?? '', 'base64');
  const key = await derive(password, Buffer.from(salt ?? '', 'base64'), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expectedKey.length,
  });
  return key.length === expectedKey.length && timingSafeEqual(key, expectedKey);
}

/** 256-bit opaque bearer token, URL-safe. Only its digest is stored. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Keyed HMAC-SHA256 digest stored instead of the raw token. */
export function digestToken(token: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(token).digest();
}
