-- M2: workflow states and tasks (ADR-019).
ALTER TABLE "projects"
  ADD COLUMN "next_task_number" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "projects_next_task_number_check" CHECK ("next_task_number" > 0);

CREATE TABLE "workflow_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "key" VARCHAR(32) NOT NULL,
  "label" VARCHAR(50) NOT NULL,
  "category" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_states_scope_key"
    UNIQUE ("organization_id", "project_id", "id"),
  CONSTRAINT "workflow_states_project_id_key_key" UNIQUE ("project_id", "key"),
  CONSTRAINT "workflow_states_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workflow_states_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT "workflow_states_category_check"
    CHECK ("category" IN ('todo', 'in_progress', 'done'))
);

CREATE TABLE "tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(20000) NOT NULL DEFAULT '',
  "state_id" UUID NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'none',
  "assignee_user_id" UUID,
  "due_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tasks_organization_id_id_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "tasks_project_id_number_key" UNIQUE ("project_id", "number"),
  CONSTRAINT "tasks_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  -- A task's state must belong to the task's own project.
  CONSTRAINT "tasks_state_fkey"
    FOREIGN KEY ("organization_id", "project_id", "state_id")
    REFERENCES "workflow_states" ("organization_id", "project_id", "id"),
  CONSTRAINT "tasks_assignee_membership_fkey"
    FOREIGN KEY ("organization_id", "assignee_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id"),
  CONSTRAINT "tasks_creator_membership_fkey"
    FOREIGN KEY ("organization_id", "created_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id"),
  CONSTRAINT "tasks_title_check" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "tasks_number_check" CHECK ("number" > 0),
  CONSTRAINT "tasks_priority_check"
    CHECK ("priority" IN ('none', 'low', 'medium', 'high', 'urgent')),
  CONSTRAINT "tasks_version_check" CHECK ("version" > 0)
);
CREATE INDEX "tasks_organization_id_project_id_state_id_idx"
  ON "tasks" ("organization_id", "project_id", "state_id", "number");
CREATE INDEX "tasks_organization_id_assignee_user_id_idx"
  ON "tasks" ("organization_id", "assignee_user_id");
CREATE INDEX "tasks_organization_id_due_at_idx"
  ON "tasks" ("organization_id", "due_at");

CREATE TRIGGER "workflow_states_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "workflow_states"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
CREATE TRIGGER "tasks_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();

-- Moving a task between projects would break its key and history.
CREATE FUNCTION "prevent_task_project_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."project_id" IS DISTINCT FROM OLD."project_id" THEN
    RAISE EXCEPTION 'task project_id is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "tasks_project_immutable"
  BEFORE UPDATE OF "project_id" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "prevent_task_project_change"();

-- Existing projects get the default workflow.
INSERT INTO "workflow_states" ("organization_id", "project_id", "key", "label", "category", "position")
SELECT p."organization_id", p."id", s."key", s."label", s."category", s."position"
FROM "projects" p
CROSS JOIN (VALUES
  ('todo', 'To do', 'todo', 1),
  ('in_progress', 'In progress', 'in_progress', 2),
  ('done', 'Done', 'done', 3)
) AS s ("key", "label", "category", "position");
