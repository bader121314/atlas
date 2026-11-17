import { describe, expect, it } from 'vitest';
import {
  encodeRfc3986,
  presign,
  storageSettings,
} from '../packages/shared/src';

describe('S3 presigned URLs', () => {
  it('matches the AWS Signature Version 4 documentation example', () => {
    // From the Amazon S3 documentation for query-string authentication.
    const url = presign(
      {
        endpoint: 'https://s3.amazonaws.com',
        bucket: 'examplebucket',
        region: 'us-east-1',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        style: 'virtual',
      },
      {
        method: 'GET',
        key: 'test.txt',
        expiresSeconds: 86400,
        now: new Date('2013-05-24T00:00:00Z'),
      },
    );
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('uses path-style URLs and signs required headers', () => {
    const url = new URL(
      presign(
        {
          endpoint: 'http://127.0.0.1:9000',
          bucket: 'atlas',
          region: 'us-east-1',
          accessKey: 'key',
          secretKey: 'secret',
        },
        {
          method: 'PUT',
          key: 'org/a b.png',
          expiresSeconds: 300,
          headers: { 'content-type': 'image/png' },
        },
      ),
    );
    expect(url.origin).toBe('http://127.0.0.1:9000');
    expect(url.pathname).toBe('/atlas/org/a%20b.png');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host',
    );
  });

  it('encodes as RFC 3986 requires and reads settings safely', () => {
    expect(encodeRfc3986("a b!'()*~")).toBe('a%20b%21%27%28%29%2A~');
    expect(storageSettings({})).toBeUndefined();
    expect(
      storageSettings({
        STORAGE_ENDPOINT: 'ftp://x',
        STORAGE_BUCKET: 'b',
        STORAGE_ACCESS_KEY: 'k',
        STORAGE_SECRET_KEY: 's',
      }),
    ).toBeUndefined();
  });
});
