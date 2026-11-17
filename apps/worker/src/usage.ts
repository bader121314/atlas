import type { PoolClient } from 'pg';

export type UsageMetric = 'webhook_deliveries' | 'notification_emails';

/**
 * Adds to an organization's monthly usage (ADR-056) inside the caller's
 * transaction, so a counted delivery or email is never lost or doubled.
 */
export async function countUsage(
  client: Pick<PoolClient, 'query'>,
  organizationId: string,
  metric: UsageMetric,
  amount = 1,
): Promise<void> {
  await client.query(
    `INSERT INTO usage_counters (organization_id, period, metric, count)
     VALUES ($1, date_trunc('month', now() AT TIME ZONE 'UTC')::date, $2, $3)
     ON CONFLICT (organization_id, period, metric)
       DO UPDATE SET count = usage_counters.count + EXCLUDED.count`,
    [organizationId, metric, amount],
  );
}
