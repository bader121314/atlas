import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  CreateWebhookRequest,
  UpdateWebhookRequest,
  WebhookDelivery,
  WebhookEndpoint,
} from '@atlas/contracts';
import { checkWebhookUrl, sealSecret, webhookSettings } from '@atlas/shared';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

const MAX_ENDPOINTS = 10;

interface EndpointRow {
  id: string;
  url: string;
  description: string;
  events: WebhookEndpoint['events'];
  status: WebhookEndpoint['status'];
  consecutive_failures: number;
  created_at: Date;
}

const ENDPOINT = `id, url, description, events, status, consecutive_failures, created_at`;

function toEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at.toISOString(),
  };
}

/** Organization webhook endpoints and their delivery history (ADR-036). */
@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private settings() {
    const settings = webhookSettings(process.env);
    if (!settings) throw new ServiceUnavailableException();
    return settings;
  }

  private checkUrl(url: string): void {
    const settings = this.settings();
    const problem = checkWebhookUrl(url, settings);
    if (problem)
      throw new BadRequestException(`Webhook URL refused: ${problem}`);
  }

  async list(tenant: TenantContext): Promise<WebhookEndpoint[]> {
    const result = await this.database.pool.query<EndpointRow>(
      `SELECT ${ENDPOINT} FROM webhook_endpoints WHERE organization_id = $1
       ORDER BY created_at`,
      [tenant.organizationId],
    );
    return result.rows.map(toEndpoint);
  }

  /** Creates an endpoint; the signing secret is returned this once only. */
  async create(
    tenant: TenantContext,
    userId: string,
    input: CreateWebhookRequest,
  ): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    const { material } = this.settings();
    this.checkUrl(input.url);
    const count = await this.database.pool.query<{ count: string }>(
      'SELECT count(*) FROM webhook_endpoints WHERE organization_id = $1',
      [tenant.organizationId],
    );
    if (Number(count.rows[0]?.count) >= MAX_ENDPOINTS)
      throw new BadRequestException('Endpoint limit reached');
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    const result = await this.database.pool.query<EndpointRow>(
      `INSERT INTO webhook_endpoints (organization_id, url, description, events,
         secret_sealed, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ENDPOINT}`,
      [
        tenant.organizationId,
        input.url,
        input.description,
        input.events,
        sealSecret(secret, material),
        userId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('webhook insert returned no row');
    return { endpoint: toEndpoint(row), secret };
  }

  async update(
    tenant: TenantContext,
    id: string,
    input: UpdateWebhookRequest,
  ): Promise<WebhookEndpoint> {
    if (input.url) this.checkUrl(input.url);
    const result = await this.database.pool.query<EndpointRow>(
      `UPDATE webhook_endpoints SET
         url = COALESCE($3, url),
         description = COALESCE($4, description),
         events = COALESCE($5, events),
         status = COALESCE($6, status),
         consecutive_failures = CASE WHEN $6 = 'active' THEN 0 ELSE consecutive_failures END
       WHERE organization_id = $1 AND id = $2 RETURNING ${ENDPOINT}`,
      [
        tenant.organizationId,
        id,
        input.url ?? null,
        input.description ?? null,
        input.events ?? null,
        input.status ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return toEndpoint(row);
  }

  async remove(tenant: TenantContext, id: string): Promise<void> {
    const result = await this.database.pool.query(
      'DELETE FROM webhook_endpoints WHERE organization_id = $1 AND id = $2',
      [tenant.organizationId, id],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
  }

  async deliveries(
    tenant: TenantContext,
    id: string,
  ): Promise<WebhookDelivery[]> {
    await this.endpoint(tenant, id);
    const result = await this.database.pool.query<{
      id: string;
      event_id: string;
      event_type: string;
      status: WebhookDelivery['status'];
      attempts: number;
      last_status_code: number | null;
      last_error: string | null;
      created_at: Date;
      delivered_at: Date | null;
    }>(
      `SELECT id, event_id, event_type, status, attempts, last_status_code, last_error,
              created_at, delivered_at
       FROM webhook_deliveries WHERE organization_id = $1 AND endpoint_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [tenant.organizationId, id],
    );
    return result.rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      eventType: r.event_type,
      status: r.status,
      attempts: r.attempts,
      lastStatusCode: r.last_status_code,
      lastError: r.last_error,
      createdAt: r.created_at.toISOString(),
      deliveredAt: r.delivered_at?.toISOString() ?? null,
    }));
  }

  /**
   * Sends a delivery again with the same event id, so receivers that
   * already processed it can recognize the repeat.
   */
  async replay(
    tenant: TenantContext,
    id: string,
    deliveryId: string,
  ): Promise<void> {
    const result = await this.database.pool.query(
      `UPDATE webhook_deliveries SET status = 'pending', attempts = 0,
         next_attempt_at = now(), last_error = NULL, last_status_code = NULL
       WHERE organization_id = $1 AND endpoint_id = $2 AND id = $3`,
      [tenant.organizationId, id, deliveryId],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
  }

  /** Queues a `webhook.ping` delivery to check an endpoint. */
  async ping(tenant: TenantContext, id: string): Promise<void> {
    await this.endpoint(tenant, id);
    await this.database.pool.query(
      `WITH event AS (SELECT gen_random_uuid() AS id)
       INSERT INTO webhook_deliveries (organization_id, endpoint_id, event_id, event_type, payload)
       SELECT $1, $2, event.id, 'webhook.ping',
         jsonb_build_object('id', event.id, 'type', 'webhook.ping',
           'occurredAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       FROM event`,
      [tenant.organizationId, id],
    );
  }

  private async endpoint(tenant: TenantContext, id: string): Promise<void> {
    const found = await this.database.pool.query(
      'SELECT 1 FROM webhook_endpoints WHERE organization_id = $1 AND id = $2',
      [tenant.organizationId, id],
    );
    if (!found.rowCount) throw new NotFoundException();
  }
}
