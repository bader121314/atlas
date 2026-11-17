import type { Pool } from 'pg';
import {
  MAX_ATTACHMENT_BYTES,
  isAllowedType,
  scannerFromEnv,
  sniffType,
} from '@atlas/shared';
import type { MalwareScanner } from '@atlas/shared';

/** What the checker needs from storage; ObjectStore implements it. */
export interface CheckerStore {
  head(key: string, length: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

const PENDING_HOURS = 1;

interface Row {
  id: string;
  content_type: string;
  storage_key: string;
}

/**
 * Checks quarantined uploads (ADR-034): the first bytes must match the
 * declared type and the scanner must pass the whole file (ADR-065). Rejected
 * files are deleted from storage at once. A storage or scanner error leaves
 * the batch quarantined for the next run.
 */
export async function checkBatch(
  pool: Pool,
  store: CheckerStore,
  options: {
    organizationId?: string;
    batchSize?: number;
    scanner?: MalwareScanner;
  } = {},
): Promise<{ clean: number; rejected: number }> {
  const scanner = options.scanner ?? scannerFromEnv(process.env);
  const client = await pool.connect();
  const result = { clean: 0, rejected: 0 };
  try {
    await client.query('BEGIN');
    const rows = await client.query<Row>(
      `SELECT id, content_type, storage_key FROM attachments
       WHERE status = 'quarantined' AND ($2::uuid IS NULL OR organization_id = $2)
       ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [options.batchSize ?? 10, options.organizationId ?? null],
    );
    for (const row of rows.rows) {
      // Uploads are capped at 10 MB, so the whole file fits in memory.
      const bytes = await store.head(row.storage_key, MAX_ATTACHMENT_BYTES);
      let reason: string | undefined;
      if (!isAllowedType(row.content_type)) reason = 'type';
      else if (sniffType(bytes, row.content_type) !== row.content_type)
        reason = 'type';
      else if ((await scanner.scan(bytes)) === 'infected') reason = 'malware';
      if (reason) {
        await store.remove(row.storage_key);
        result.rejected += 1;
      } else {
        result.clean += 1;
      }
      await client.query(
        `UPDATE attachments SET status = $2, rejection_reason = $3, checked_at = now()
         WHERE id = $1`,
        [row.id, reason ? 'rejected' : 'clean', reason ?? null],
      );
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

/** Removes uploads that were started but never completed. */
export async function removeAbandoned(
  pool: Pool,
  store: CheckerStore,
): Promise<number> {
  const rows = await pool.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM attachments
     WHERE status = 'pending' AND created_at < now() - ($1 * interval '1 hour')
     LIMIT 100`,
    [PENDING_HOURS],
  );
  for (const row of rows.rows) {
    await store.remove(row.storage_key);
    await pool.query(
      `DELETE FROM attachments WHERE id = $1 AND status = 'pending'`,
      [row.id],
    );
  }
  return rows.rows.length;
}
