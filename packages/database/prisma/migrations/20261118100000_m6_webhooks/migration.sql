-- M6: signed outbound webhooks with delivery history (ADR-036).

-- The webhook planner turns outbox events into deliveries exactly once.
ALTER TABLE "outbox_events" ADD COLUMN "webhooks_at" TIMESTAMPTZ(6);
UPDATE "outbox_events" SET "webhooks_at" = CURRENT_TIMESTAMP;
CREATE INDEX "outbox_events_webhooks_idx"
  ON "outbox_events" ("occurred_at") WHERE "webhooks_at" IS NULL;

CREATE TABLE "webhook_endpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "url" VARCHAR(2000) NOT NULL,
  "description" VARCHAR(200) NOT NULL DEFAULT '',
  "events" TEXT[] NOT NULL,
  -- AES-256-GCM sealed signing secret; shown to the admin once.
  "secret_sealed" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_endpoints_scope_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "webhook_endpoints_status_check" CHECK ("status" IN ('active', 'paused')),
  CONSTRAINT "webhook_endpoints_events_check" CHECK (
    cardinality("events") > 0
    AND "events" <@ ARRAY['task.created', 'task.updated', 'comment.created']::TEXT[]),
  CONSTRAINT "webhook_endpoints_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE
);

CREATE TABLE "webhook_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "endpoint_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_status_code" INTEGER,
  "last_error" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_at" TIMESTAMPTZ(6),
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
  -- One delivery per endpoint and event; a replay reuses it.
  CONSTRAINT "webhook_deliveries_dedupe_key" UNIQUE ("endpoint_id", "event_id"),
  CONSTRAINT "webhook_deliveries_status_check"
    CHECK ("status" IN ('pending', 'delivered', 'failed')),
  CONSTRAINT "webhook_deliveries_endpoint_fkey"
    FOREIGN KEY ("organization_id", "endpoint_id")
    REFERENCES "webhook_endpoints" ("organization_id", "id") ON DELETE CASCADE
);
CREATE INDEX "webhook_deliveries_due_idx"
  ON "webhook_deliveries" ("next_attempt_at") WHERE "status" = 'pending';
CREATE INDEX "webhook_deliveries_history_idx"
  ON "webhook_deliveries" ("endpoint_id", "created_at" DESC);
CREATE TRIGGER "webhook_endpoints_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "webhook_endpoints"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
CREATE TRIGGER "webhook_deliveries_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "webhook_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
