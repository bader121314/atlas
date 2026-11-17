-- M5: background task exports (ADR-035).
CREATE TABLE "exports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
  "row_count" INTEGER,
  "storage_key" VARCHAR(300),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6),
  CONSTRAINT "exports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exports_status_check"
    CHECK ("status" IN ('queued', 'ready', 'failed', 'expired')),
  CONSTRAINT "exports_ready_check"
    CHECK ("status" <> 'ready' OR ("storage_key" IS NOT NULL AND "expires_at" IS NOT NULL)),
  CONSTRAINT "exports_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "exports_requester_membership_fkey"
    FOREIGN KEY ("organization_id", "requested_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
CREATE INDEX "exports_requester_idx"
  ON "exports" ("project_id", "requested_by_user_id", "created_at" DESC);
CREATE INDEX "exports_queue_idx" ON "exports" ("created_at") WHERE "status" = 'queued';
CREATE TRIGGER "exports_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "exports"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
