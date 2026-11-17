-- Multiple assignees per task (ADR-046).
-- tasks.assignee_user_id stays as the primary assignee; task_assignees holds
-- everyone. A trigger keeps the two consistent for every writer (API,
-- automation rules, recurring tasks).
CREATE TABLE "task_assignees" (
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id", "user_id"),
  CONSTRAINT "task_assignees_task_fkey"
    FOREIGN KEY ("organization_id", "project_id", "task_id")
    REFERENCES "tasks" ("organization_id", "project_id", "id") ON DELETE CASCADE,
  CONSTRAINT "task_assignees_membership_fkey"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
CREATE INDEX "task_assignees_user_idx" ON "task_assignees" ("organization_id", "user_id");
CREATE TRIGGER "task_assignees_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "task_assignees"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();

INSERT INTO "task_assignees" ("organization_id", "project_id", "task_id", "user_id")
  SELECT "organization_id", "project_id", "id", "assignee_user_id"
  FROM "tasks" WHERE "assignee_user_id" IS NOT NULL;

-- Setting the primary assignee adds them; replacing it removes the previous
-- primary; clearing it unassigns everyone.
CREATE FUNCTION "sync_primary_assignee"() RETURNS trigger AS $$
BEGIN
  IF NEW."assignee_user_id" IS NULL THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM "task_assignees" WHERE "task_id" = NEW."id";
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."assignee_user_id" IS NOT NULL
     AND OLD."assignee_user_id" <> NEW."assignee_user_id" THEN
    DELETE FROM "task_assignees"
      WHERE "task_id" = NEW."id" AND "user_id" = OLD."assignee_user_id";
  END IF;
  INSERT INTO "task_assignees" ("organization_id", "project_id", "task_id", "user_id")
    VALUES (NEW."organization_id", NEW."project_id", NEW."id", NEW."assignee_user_id")
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tasks_sync_primary_assignee"
  AFTER INSERT OR UPDATE OF "assignee_user_id" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "sync_primary_assignee"();
