-- M4: in-app notifications and email delivery (ADR-031).

-- The notifier turns outbox events into notifications exactly once.
ALTER TABLE "outbox_events" ADD COLUMN "notified_at" TIMESTAMPTZ(6);
-- Events from before this migration never notify anyone.
UPDATE "outbox_events" SET "notified_at" = CURRENT_TIMESTAMP;
CREATE INDEX "outbox_events_unnotified_idx"
  ON "outbox_events" ("occurred_at") WHERE "notified_at" IS NULL;

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "project_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "source_event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMPTZ(6),
  "email_status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_kind_check"
    CHECK ("kind" IN ('task.assigned', 'comment.created')),
  CONSTRAINT "notifications_email_status_check"
    CHECK ("email_status" IN ('pending', 'sent', 'skipped')),
  -- One notification per person per event, however often it is processed.
  CONSTRAINT "notifications_dedupe_key" UNIQUE ("recipient_user_id", "source_event_id"),
  CONSTRAINT "notifications_recipient_membership_fkey"
    FOREIGN KEY ("organization_id", "recipient_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "notifications_task_fkey"
    FOREIGN KEY ("organization_id", "project_id", "task_id")
    REFERENCES "tasks" ("organization_id", "project_id", "id") ON DELETE CASCADE
);
CREATE INDEX "notifications_inbox_idx"
  ON "notifications" ("recipient_user_id", "organization_id", "created_at" DESC);
CREATE INDEX "notifications_email_idx"
  ON "notifications" ("created_at") WHERE "email_status" = 'pending';
CREATE TRIGGER "notifications_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();

CREATE TABLE "notification_settings" (
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "email_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("organization_id", "user_id"),
  CONSTRAINT "notification_settings_membership_fkey"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
