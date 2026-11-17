import { createHash, createHmac } from 'node:crypto';

/**
 * S3-compatible object storage through presigned URLs (ADR-034). Signature
 * Version 4 query signing is implemented here with node:crypto, so the API
 * and the worker need no SDK; every request, including the server's own
 * HEAD, GET and DELETE, uses a short-lived presigned URL.
 */
export interface StorageSettings {
  /** e.g. http://127.0.0.1:9000 (path-style) */
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /** Path-style (MinIO, most self-hosted) or virtual-hosted (AWS). */
  style?: 'path' | 'virtual';
}

export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  key: string;
  expiresSeconds: number;
  /** Headers the request must send exactly (signed), lowercase names. */
  headers?: Record<string, string>;
  /** Extra query parameters, e.g. response-content-disposition. */
  query?: Record<string, string>;
  now?: Date;
}

/** Reads storage settings from the environment; undefined if unset. */
export function storageSettings(
  env: Record<string, string | undefined>,
): StorageSettings | undefined {
  const { STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY } = env;
  const secret = env.STORAGE_SECRET_KEY;
  if (!STORAGE_ENDPOINT || !STORAGE_BUCKET || !STORAGE_ACCESS_KEY || !secret)
    return undefined;
  try {
    const url = new URL(STORAGE_ENDPOINT);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return {
      endpoint: url.origin,
      bucket: STORAGE_BUCKET,
      region: env.STORAGE_REGION ?? 'us-east-1',
      accessKey: STORAGE_ACCESS_KEY,
      secretKey: secret,
      style: env.STORAGE_STYLE === 'virtual' ? 'virtual' : 'path',
    };
  } catch {
    return undefined;
  }
}

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent plus !'()*). */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function location(settings: StorageSettings, key: string) {
  const url = new URL(settings.endpoint);
  const path = key.split('/').map(encodeRfc3986).join('/');
  return settings.style === 'virtual'
    ? {
        origin: `${url.protocol}//${settings.bucket}.${url.host}`,
        host: `${settings.bucket}.${url.host}`,
        uri: `/${path}`,
      }
    : {
        origin: url.origin,
        host: url.host,
        uri: `/${settings.bucket}/${path}`,
      };
}

/** The SigV4 signature over a canonical request (exported for tests). */
export function signature(
  settings: Pick<StorageSettings, 'secretKey' | 'region'>,
  input: {
    method: string;
    uri: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    amzDate: string;
  },
): string {
  const day = input.amzDate.slice(0, 8);
  const query = Object.keys(input.query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(input.query[k] ?? '')}`)
    .join('&');
  const names = Object.keys(input.headers).sort();
  const canonical = [
    input.method,
    input.uri,
    query,
    names.map((n) => `${n}:${(input.headers[n] ?? '').trim()}\n`).join(''),
    names.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const scope = `${day}/${settings.region}/s3/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    input.amzDate,
    scope,
    sha256(canonical),
  ].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${settings.secretKey}`, day), settings.region), 's3'),
    'aws4_request',
  );
  return createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
}

/** A presigned URL for one request. */
export function presign(
  settings: StorageSettings,
  input: PresignInput,
): string {
  const now = input.now ?? new Date();
  const stamp = amzDate(now);
  const { origin, host, uri } = location(settings, input.key);
  const headers = { host, ...(input.headers ?? {}) };
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${settings.accessKey}/${stamp.slice(0, 8)}/${settings.region}/s3/aws4_request`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': Object.keys(headers).sort().join(';'),
    ...(input.query ?? {}),
  };
  const signed = signature(settings, {
    method: input.method,
    uri,
    query,
    headers,
    amzDate: stamp,
  });
  const search = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k] ?? '')}`)
    .join('&');
  return `${origin}${uri}?${search}&X-Amz-Signature=${signed}`;
}

/** Server-side operations, each through a one-minute presigned URL. */
export class ObjectStore {
  constructor(private readonly settings: StorageSettings) {}

  uploadUrl(key: string, contentType: string, expiresSeconds = 300): string {
    return presign(this.settings, {
      method: 'PUT',
      key,
      expiresSeconds,
      headers: { 'content-type': contentType },
    });
  }

  downloadUrl(key: string, filename: string, contentType: string): string {
    return presign(this.settings, {
      method: 'GET',
      key,
      expiresSeconds: 60,
      query: {
        'response-content-disposition': `attachment; filename*=UTF-8''${encodeRfc3986(filename)}`,
        'response-content-type': contentType,
      },
    });
  }

  /** Size of a stored object, or undefined if it does not exist. */
  async size(key: string): Promise<number | undefined> {
    const response = await fetch(
      presign(this.settings, { method: 'HEAD', key, expiresSeconds: 60 }),
      { method: 'HEAD' },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`storage HEAD ${response.status}`);
    return Number(response.headers.get('content-length') ?? '0');
  }

  /** The first `length` bytes of an object. */
  async head(key: string, length: number): Promise<Uint8Array> {
    const response = await fetch(
      presign(this.settings, {
        method: 'GET',
        key,
        expiresSeconds: 60,
        headers: { range: `bytes=0-${length - 1}` },
      }),
      { headers: { range: `bytes=0-${length - 1}` } },
    );
    if (!response.ok) throw new Error(`storage GET ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const response = await fetch(
      presign(this.settings, { method: 'DELETE', key, expiresSeconds: 60 }),
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 404)
      throw new Error(`storage DELETE ${response.status}`);
  }
}
