import { resolveTxt } from 'node:dns/promises';
import type { Pool } from 'pg';

export type TxtLookup = (name: string) => Promise<string[]>;

export const dnsTxt: TxtLookup = async (name) => {
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(''));
  } catch {
    return [];
  }
};

/** Missed checks in a row before a domain loses verification. */
export const MAX_FAILED_CHECKS = 3;

/**
 * Re-checks verified domains once a day (ADR-057). A record that is still
 * published resets the count; one missing for three checks in a row ends
 * the verification, which also stops SSO and the provisioning limit for
 * that domain until an owner verifies again. Transient DNS failures look
 * like a missing record, hence the allowance.
 */
export async function recheckDomains(
  pool: Pool,
  lookup: TxtLookup,
  options: { organizationId?: string; now?: boolean } = {},
): Promise<{ checked: number; unverified: number }> {
  const client = await pool.connect();
  const result = { checked: 0, unverified: 0 };
  try {
    await client.query('BEGIN');
    const due = await client.query<{
      id: string;
      organization_id: string;
      domain: string;
      verification_token: string;
      failed_checks: number;
    }>(
      `SELECT id, organization_id, domain, verification_token, failed_checks
       FROM organization_domains
       WHERE verified_at IS NOT NULL
         AND ($2::boolean OR checked_at IS NULL OR checked_at < now() - interval '1 day')
         AND ($1::uuid IS NULL OR organization_id = $1)
       ORDER BY checked_at NULLS FIRST LIMIT 20
       FOR UPDATE SKIP LOCKED`,
      [options.organizationId ?? null, options.now ?? false],
    );
    for (const row of due.rows) {
      result.checked += 1;
      const records = await lookup(`_atlas-challenge.${row.domain}`);
      if (
        records.includes(`atlas-domain-verification=${row.verification_token}`)
      ) {
        await client.query(
          `UPDATE organization_domains SET checked_at = now(), failed_checks = 0 WHERE id = $1`,
          [row.id],
        );
        continue;
      }
      const failed = row.failed_checks + 1;
      if (failed < MAX_FAILED_CHECKS) {
        await client.query(
          `UPDATE organization_domains SET checked_at = now(), failed_checks = $2 WHERE id = $1`,
          [row.id, failed],
        );
        continue;
      }
      await client.query(
        `UPDATE organization_domains
         SET verified_at = NULL, checked_at = now(), failed_checks = 0 WHERE id = $1`,
        [row.id],
      );
      await client.query(
        `INSERT INTO audit_events (organization_id, action, target_type, target_id, metadata)
         VALUES ($1, 'org.domain.unverified', 'domain', $2, $3)`,
        [
          row.organization_id,
          row.id,
          JSON.stringify({ domain: row.domain, reason: 'record_missing' }),
        ],
      );
      result.unverified += 1;
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
