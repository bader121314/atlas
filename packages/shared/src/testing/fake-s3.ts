import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signature } from '../storage';

interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * TEST DOUBLE, never used by the application. A minimal S3 stand-in for
 * integration and browser tests: path-style buckets, presigned query
 * authentication verified with the same SigV4 code (itself checked against
 * the AWS documentation example), and PUT, GET with Range, HEAD and DELETE.
 */
export async function startFakeS3(
  credentials = { accessKey: 'test-key', secretKey: 'test-secret' },
  options: { port?: number; bucket?: string } = {},
) {
  const objects = new Map<string, StoredObject>();
  const region = 'us-east-1';

  function verify(
    method: string,
    rawUrl: string,
    headers: Record<string, string | string[] | undefined>,
    host: string,
  ) {
    const url = new URL(rawUrl, `http://${host}`);
    const query = Object.fromEntries(url.searchParams);
    const given = query['X-Amz-Signature'];
    delete query['X-Amz-Signature'];
    const stamp = query['X-Amz-Date'] ?? '';
    const issued = Date.parse(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
    );
    if (Date.now() > issued + Number(query['X-Amz-Expires'] ?? 0) * 1000)
      return false;
    if (!query['X-Amz-Credential']?.startsWith(`${credentials.accessKey}/`))
      return false;
    const signed = Object.fromEntries(
      (query['X-Amz-SignedHeaders'] ?? '').split(';').map((name) => {
        const value = name === 'host' ? host : headers[name];
        return [name, Array.isArray(value) ? value.join(',') : (value ?? '')];
      }),
    );
    const expected = signature(
      { secretKey: credentials.secretKey, region },
      { method, uri: url.pathname, query, headers: signed, amzDate: stamp },
    );
    return expected === given;
  }

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const method = request.method ?? 'GET';
      const host = request.headers.host ?? '';
      // Browsers upload directly, so answer CORS like a configured bucket.
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Methods': 'PUT, GET, HEAD',
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Max-Age': '600',
        });
        response.end();
        return;
      }
      if (!verify(method, request.url ?? '/', request.headers, host)) {
        response.writeHead(403).end('SignatureDoesNotMatch');
        return;
      }
      const url = new URL(request.url ?? '/', `http://${host}`);
      const key = decodeURIComponent(url.pathname);
      const object = objects.get(key);
      if (method === 'PUT') {
        objects.set(key, {
          body: Buffer.concat(chunks),
          contentType: String(request.headers['content-type'] ?? ''),
        });
        response.writeHead(200).end();
        return;
      }
      if (method === 'DELETE') {
        objects.delete(key);
        response.writeHead(204).end();
        return;
      }
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      const range = /^bytes=(\d+)-(\d+)$/.exec(
        String(request.headers.range ?? ''),
      );
      const body = range
        ? object.body.subarray(Number(range[1]), Number(range[2]) + 1)
        : object.body;
      response.writeHead(range ? 206 : 200, {
        'content-length': String(
          method === 'HEAD' ? object.body.length : body.length,
        ),
        'content-type':
          url.searchParams.get('response-content-type') ?? object.contentType,
        ...(url.searchParams.get('response-content-disposition')
          ? {
              'content-disposition':
                url.searchParams.get('response-content-disposition') ?? '',
            }
          : {}),
      });
      response.end(method === 'HEAD' ? undefined : body);
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, '127.0.0.1', resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    env: {
      STORAGE_ENDPOINT: `http://127.0.0.1:${port}`,
      STORAGE_BUCKET: options.bucket ?? 'atlas-test',
      STORAGE_ACCESS_KEY: credentials.accessKey,
      STORAGE_SECRET_KEY: credentials.secretKey,
    },
    objects,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
