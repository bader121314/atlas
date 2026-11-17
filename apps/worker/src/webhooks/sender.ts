import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Pool } from 'pg';
import { isPublicAddress, openSecret, signWebhook } from '@atlas/shared';

export const MAX_ATTEMPTS = 8;
/** Failed attempts in a row before an endpoint is paused. */
export const PAUSE_AFTER = 15;

export interface SendOptions {
  /** Key material that seals endpoint secrets (WEBHOOK_SECRET_KEY). */
  material: string;
  /** Hosts exempt from the address check: development and tests only. */
  allowedHosts?: readonly string[];
  timeoutMs?: number;
  organizationId?: string;
}

export type DeliveryError = 'blocked' | 'timeout' | 'network' | 'status';

export interface Outcome {
  ok: boolean;
  status?: number | undefined;
  error?: DeliveryError | undefined;
}

/** Delay before attempt `n + 1` after `n` failures: 10 s doubling, at most 1 h. */
export function retryDelayMs(failures: number): number {
  return Math.min(10_000 * 2 ** Math.max(failures - 1, 0), 3_600_000);
}

/**
 * POSTs one webhook. The connection only goes to an address checked after
 * DNS resolution (so rebinding cannot redirect it to a private network),
 * redirects are not followed, and the response body is ignored.
 */
export function post(
  target: string,
  body: string,
  headers: Record<string, string>,
  options: { allowedHosts?: readonly string[]; timeoutMs?: number } = {},
): Promise<Outcome> {
  const url = new URL(target);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const exempt = options.allowedHosts?.includes(host) ?? false;
  if (isIP(host) && !exempt && !isPublicAddress(host)) {
    return Promise.resolve({ ok: false, error: 'blocked' });
  }
  let blockedLookup = false;
  const lookup = (
    hostname: string,
    lookupOptions: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error, '');
      if (
        !exempt &&
        (addresses.length === 0 ||
          !addresses.every((a) => isPublicAddress(a.address)))
      ) {
        blockedLookup = true;
        return callback(new Error('blocked address'), '');
      }
      if (lookupOptions.all) return callback(null, addresses);
      const first = addresses[0];
      return callback(null, first?.address ?? '', first?.family);
    });
  };
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const req = send(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'content-length': String(Buffer.byteLength(body)),
        },
        lookup: lookup as never,
        timeout: options.timeoutMs ?? 5000,
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        resolve(
          status >= 200 && status < 300
            ? { ok: true, status }
            : { ok: false, status, error: 'status' },
        );
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', () =>
      resolve({ ok: false, error: blockedLookup ? 'blocked' : 'network' }),
    );
    req.end(body);
  });
}

interface Due {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret_sealed: string;
}

/**
 * Sends due deliveries (ADR-036). Each attempt is recorded; failures retry
 * with backoff up to eight attempts, and an endpoint that keeps failing is
 * paused. Receivers deduplicate by the X-Atlas-Event-Id header.
 */
export async function deliverBatch(
  pool: Pool,
  options: SendOptions,
): Promise<{ delivered: number; failed: number }> {
  const client = await pool.connect();
  const result = { delivered: 0, failed: 0 };
  try {
    await client.query('BEGIN');
    const due = await client.query<Due>(
      `SELECT d.id, d.endpoint_id, d.event_id, d.event_type, d.payload, d.attempts,
              e.url, e.secret_sealed
       FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.organization_id = d.organization_id AND e.id = d.endpoint_id
       WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND e.status = 'active'
         AND ($1::uuid IS NULL OR d.organization_id = $1)
       ORDER BY d.next_attempt_at LIMIT 20
       FOR UPDATE OF d SKIP LOCKED`,
      [options.organizationId ?? null],
    );
    for (const delivery of due.rows) {
      const body = JSON.stringify(delivery.payload);
      const timestamp = Math.floor(Date.now() / 1000);
      let outcome: Outcome;
      try {
        const secret = openSecret(delivery.secret_sealed, options.material);
        outcome = await post(
          delivery.url,
          body,
          {
            'content-type': 'application/json',
            'user-agent': 'Atlas-Webhooks/1',
            'x-atlas-event-id': delivery.event_id,
            'x-atlas-event-type': delivery.event_type,
            'x-atlas-timestamp': String(timestamp),
            'x-atlas-signature': signWebhook(secret, timestamp, body),
          },
          options,
        );
      } catch {
        outcome = { ok: false, error: 'network' };
      }
      const attempts = delivery.attempts + 1;
      if (outcome.ok) {
        await client.query(
          `UPDATE webhook_deliveries SET status = 'delivered', attempts = $2,
             last_status_code = $3, last_error = NULL, delivered_at = now() WHERE id = $1`,
          [delivery.id, attempts, outcome.status],
        );
        await client.query(
          'UPDATE webhook_endpoints SET consecutive_failures = 0 WHERE id = $1',
          [delivery.endpoint_id],
        );
        result.delivered += 1;
        continue;
      }
      const final = attempts >= MAX_ATTEMPTS;
      await client.query(
        `UPDATE webhook_deliveries SET status = $2, attempts = $3, last_status_code = $4,
           last_error = $5, next_attempt_at = now() + ($6 * interval '1 millisecond')
         WHERE id = $1`,
        [
          delivery.id,
          final ? 'failed' : 'pending',
          attempts,
          outcome.status ?? null,
          outcome.error ?? 'network',
          retryDelayMs(attempts),
        ],
      );
      await client.query(
        `UPDATE webhook_endpoints SET consecutive_failures = consecutive_failures + 1,
           status = CASE WHEN consecutive_failures + 1 >= $2 THEN 'paused' ELSE status END
         WHERE id = $1`,
        [delivery.endpoint_id, PAUSE_AFTER],
      );
      result.failed += 1;
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
