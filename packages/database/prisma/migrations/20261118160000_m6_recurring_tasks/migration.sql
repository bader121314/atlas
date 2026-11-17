-- M6: recurring tasks (ADR-039).
CREATE TABLE "task_recurrences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(10000) NOT NULL DEFAULT '',
  "priority" TEXT NOT NULL DEFAULT 'none',
  "assignee_user_id" UUID,
  "frequency" VARCHAR(8) NOT NULL,
  "interval" INTEGER NOT NULL DEFAULT 1,
  "due_in_days" INTEGER,
  "next_run_at" TIMESTAMPTZ(6) NOT NULL,
  "last_run_at" TIMESTAMPTZ(6),
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_recurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_recurrences_frequency_check" CHECK ("frequency" IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT "task_recurrences_interval_check" CHECK ("interval" BETWEEN 1 AND 12),
  CONSTRAINT "task_recurrences_due_check" CHECK ("due_in_days" IS NULL OR "due_in_days" BETWEEN 0 AND 365),
  CONSTRAINT "task_recurrences_priority_check"
    CHECK ("priority" IN ('none', 'low', 'medium', 'high', 'urgent')),
  CONSTRAINT "task_recurrences_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "task_recurrences_creator_membership_fkey"
    FOREIGN KEY ("organization_id", "created_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "task_recurrences_assignee_membership_fkey"
    FOREIGN KEY ("organization_id", "assignee_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE SET NULL ("assignee_user_id")
);
CREATE INDEX "task_recurrences_due_idx" ON "task_recurrences" ("next_run_at") WHERE "enabled";
CREATE TRIGGER "task_recurrences_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "task_recurrences"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
