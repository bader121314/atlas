// Receiving Atlas webhooks safely (ADR-036), with no dependencies.
//
//   ATLAS_WEBHOOK_SECRET=whsec_... node examples/webhook-receiver.mjs
//
// Check the signature over the raw body, refuse old timestamps, and ignore
// event ids you have already handled: delivery is at least once.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const TOLERANCE_SECONDS = 300;

/** True when the request really came from Atlas and is recent. */
export function verifyAtlasSignature(
  secret,
  headers,
  rawBody,
  now = Date.now(),
) {
  const timestamp = Number(headers['x-atlas-timestamp']);
  const given = String(headers['x-atlas-signature'] ?? '');
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS
  )
    return false;
  const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  return (
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.ATLAS_WEBHOOK_SECRET;
  const seen = new Set(); // Use a database table in production.
  createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (!verifyAtlasSignature(secret, request.headers, body)) {
        response.writeHead(401).end();
        return;
      }
      const id = request.headers['x-atlas-event-id'];
      if (!seen.has(id)) {
        seen.add(id);
        const event = JSON.parse(body);
        console.log(event.type, event.task?.key ?? '', event.task?.title ?? '');
      }
      // Answer quickly; do slow work after responding.
      response.writeHead(204).end();
    });
  }).listen(Number(process.env.PORT ?? 8787));
}
