-- M2: task comments, activity history and the transactional outbox (ADR-020).
CREATE TABLE "task_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "body" VARCHAR(10000) NOT NULL,
  "edited_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_comments_task_fkey" FOREIGN KEY ("organization_id", "task_id")
    REFERENCES "tasks" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "task_comments_author_membership_fkey"
    FOREIGN KEY ("organization_id", "author_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id"),
  CONSTRAINT "task_comments_body_check" CHECK (length(btrim("body")) > 0)
);
CREATE INDEX "task_comments_organization_id_task_id_created_at_idx"
  ON "task_comments" ("organization_id", "task_id", "created_at");

CREATE TABLE "activity_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "task_id" UUID,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "changes" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "activity_events_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "activity_events_task_fkey" FOREIGN KEY ("organization_id", "task_id")
    REFERENCES "tasks" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "activity_events_action_check"
    CHECK ("action" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  CONSTRAINT "activity_events_changes_check" CHECK (jsonb_typeof("changes") = 'object')
);
CREATE INDEX "activity_events_task_idx"
  ON "activity_events" ("organization_id", "task_id", "occurred_at");
CREATE INDEX "activity_events_project_idx"
  ON "activity_events" ("organization_id", "project_id", "occurred_at");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "aggregate_type" VARCHAR(32) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "aggregate_version" BIGINT NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_payload_check" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "outbox_events_attempt_count_check" CHECK ("attempt_count" >= 0)
);
-- The dispatcher (M4) polls unpublished events in order.
CREATE INDEX "outbox_events_unpublished_idx"
  ON "outbox_events" ("occurred_at") WHERE "published_at" IS NULL;

CREATE TRIGGER "task_comments_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "task_comments"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
CREATE TRIGGER "activity_events_append_only"
  BEFORE UPDATE ON "activity_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
