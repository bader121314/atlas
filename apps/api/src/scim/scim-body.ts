import type { IncomingMessage } from 'node:http';

const LIMIT = 100 * 1024;

type BodyRequest = IncomingMessage & { body?: unknown };

/**
 * Parses `application/scim+json` bodies, which the default JSON parser
 * ignores (ADR-055). Malformed or oversized bodies are left unparsed, so
 * validation refuses them with a SCIM error.
 */
export function scimBody(
  request: BodyRequest,
  _response: unknown,
  next: () => void,
): void {
  const type = request.headers['content-type'] ?? '';
  if (!type.includes('application/scim+json') || request.readableEnded) {
    next();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  request.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > LIMIT) tooLarge = true;
    else chunks.push(chunk);
  });
  request.on('end', () => {
    if (!tooLarge) {
      try {
        request.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        request.body = undefined;
      }
    }
    next();
  });
  request.on('error', () => next());
}
