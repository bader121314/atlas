-- Monthly usage per organization (ADR-056): the basis for plans and billing.
CREATE TABLE "usage_counters" (
  "organization_id" UUID NOT NULL,
  -- First day of the month, UTC.
  "period" DATE NOT NULL,
  "metric" VARCHAR(40) NOT NULL,
  "count" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("organization_id", "period", "metric"),
  CONSTRAINT "usage_counters_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
  CONSTRAINT "usage_counters_metric_check" CHECK ("metric" IN
    ('api_requests', 'scim_requests', 'webhook_deliveries', 'notification_emails')),
  CONSTRAINT "usage_counters_period_check" CHECK (extract(day FROM "period") = 1),
  CONSTRAINT "usage_counters_count_check" CHECK ("count" >= 0)
);
