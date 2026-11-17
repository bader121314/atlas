-- M3: task dependencies and milestones (ADR-024).
CREATE TABLE "task_dependencies" (
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "blocker_task_id" UUID NOT NULL,
  "blocked_task_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("blocker_task_id", "blocked_task_id"),
  -- Both ends must be tasks of the same project in the same organization.
  CONSTRAINT "task_dependencies_blocker_fkey"
    FOREIGN KEY ("organization_id", "project_id", "blocker_task_id")
    REFERENCES "tasks" ("organization_id", "project_id", "id") ON DELETE CASCADE,
  CONSTRAINT "task_dependencies_blocked_fkey"
    FOREIGN KEY ("organization_id", "project_id", "blocked_task_id")
    REFERENCES "tasks" ("organization_id", "project_id", "id") ON DELETE CASCADE,
  CONSTRAINT "task_dependencies_not_self_check"
    CHECK ("blocker_task_id" <> "blocked_task_id")
);
CREATE INDEX "task_dependencies_blocked_idx"
  ON "task_dependencies" ("blocked_task_id");

-- "A blocks B" is refused if B already (transitively) blocks A.
CREATE FUNCTION "prevent_dependency_cycle"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reach AS (
      SELECT d."blocked_task_id" AS task_id, 1 AS depth
      FROM "task_dependencies" d WHERE d."blocker_task_id" = NEW."blocked_task_id"
      UNION
      SELECT d."blocked_task_id", reach.depth + 1
      FROM "task_dependencies" d JOIN reach ON d."blocker_task_id" = reach.task_id
      WHERE reach.depth < 200
    )
    SELECT 1 FROM reach WHERE reach.task_id = NEW."blocker_task_id"
  ) THEN
    RAISE EXCEPTION 'dependency would create a cycle'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'task_dependencies_cycle_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "task_dependencies_cycle"
  BEFORE INSERT ON "task_dependencies"
  FOR EACH ROW EXECUTE FUNCTION "prevent_dependency_cycle"();

CREATE TABLE "milestones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "due_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL DEFAULT 'open',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "milestones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "milestones_scope_key" UNIQUE ("organization_id", "project_id", "id"),
  CONSTRAINT "milestones_project_fkey" FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "milestones_title_check" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "milestones_status_check" CHECK ("status" IN ('open', 'closed'))
);

ALTER TABLE "tasks"
  ADD COLUMN "milestone_id" UUID,
  ADD CONSTRAINT "tasks_milestone_fkey"
    FOREIGN KEY ("organization_id", "project_id", "milestone_id")
    REFERENCES "milestones" ("organization_id", "project_id", "id")
    ON DELETE SET NULL ("milestone_id");
CREATE INDEX "tasks_milestone_id_idx" ON "tasks" ("milestone_id")
  WHERE "milestone_id" IS NOT NULL;

CREATE TRIGGER "milestones_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "milestones"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
