-- Time tracking (ADR-049): minutes logged against a task by a person on a day.
CREATE TABLE "time_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "minutes" INTEGER NOT NULL,
  "spent_on" DATE NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "time_entries_minutes_check" CHECK ("minutes" BETWEEN 1 AND 1440),
  CONSTRAINT "time_entries_note_check" CHECK ("note" IS NULL OR char_length("note") <= 500),
  CONSTRAINT "time_entries_task_fkey"
    FOREIGN KEY ("organization_id", "project_id", "task_id")
    REFERENCES "tasks" ("organization_id", "project_id", "id") ON DELETE CASCADE,
  CONSTRAINT "time_entries_membership_fkey"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
CREATE INDEX "time_entries_task_idx" ON "time_entries" ("task_id", "spent_on");
CREATE INDEX "time_entries_report_idx" ON "time_entries" ("organization_id", "spent_on");
CREATE TRIGGER "time_entries_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "time_entries"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
