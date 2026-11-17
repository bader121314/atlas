-- M5: task attachments in object storage (ADR-034).
CREATE TABLE "attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "filename" VARCHAR(200) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" VARCHAR(300) NOT NULL,
  -- pending: upload URL issued; quarantined: uploaded, awaiting checks;
  -- clean: downloadable; rejected: failed checks, object deleted.
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "rejection_reason" VARCHAR(32),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checked_at" TIMESTAMPTZ(6),
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attachments_storage_key_key" UNIQUE ("storage_key"),
  CONSTRAINT "attachments_status_check"
    CHECK ("status" IN ('pending', 'quarantined', 'clean', 'rejected')),
  CONSTRAINT "attachments_size_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760),
  CONSTRAINT "attachments_rejection_check"
    CHECK (("status" = 'rejected') = ("rejection_reason" IS NOT NULL)),
  CONSTRAINT "attachments_task_fkey"
    FOREIGN KEY ("organization_id", "project_id", "task_id")
    REFERENCES "tasks" ("organization_id", "project_id", "id") ON DELETE CASCADE,
  CONSTRAINT "attachments_uploader_membership_fkey"
    FOREIGN KEY ("organization_id", "uploaded_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id")
);
CREATE INDEX "attachments_task_idx" ON "attachments" ("task_id", "created_at");
CREATE INDEX "attachments_waiting_idx" ON "attachments" ("created_at")
  WHERE "status" IN ('pending', 'quarantined');
CREATE TRIGGER "attachments_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
