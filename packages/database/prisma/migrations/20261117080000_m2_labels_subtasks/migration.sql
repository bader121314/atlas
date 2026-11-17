-- M2: labels and subtasks (ADR-021).
CREATE TABLE "labels" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'sea',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "labels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "labels_organization_id_id_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "labels_organization_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations" ("id") ON DELETE RESTRICT,
  CONSTRAINT "labels_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "labels_color_check"
    CHECK ("color" IN ('slate', 'sea', 'sage', 'sand', 'rose', 'violet'))
);
CREATE UNIQUE INDEX "labels_organization_id_name_key"
  ON "labels" ("organization_id", lower("name"));

CREATE TABLE "task_labels" (
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "label_id" UUID NOT NULL,
  CONSTRAINT "task_labels_pkey" PRIMARY KEY ("task_id", "label_id"),
  CONSTRAINT "task_labels_task_fkey" FOREIGN KEY ("organization_id", "task_id")
    REFERENCES "tasks" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "task_labels_label_fkey" FOREIGN KEY ("organization_id", "label_id")
    REFERENCES "labels" ("organization_id", "id") ON DELETE CASCADE
);
CREATE INDEX "task_labels_organization_id_label_id_idx"
  ON "task_labels" ("organization_id", "label_id");

ALTER TABLE "tasks"
  ADD COLUMN "parent_task_id" UUID,
  ADD CONSTRAINT "tasks_scope_key" UNIQUE ("organization_id", "project_id", "id"),
  -- A parent must be in the same organization and the same project.
  ADD CONSTRAINT "tasks_parent_fkey"
    FOREIGN KEY ("organization_id", "project_id", "parent_task_id")
    REFERENCES "tasks" ("organization_id", "project_id", "id"),
  ADD CONSTRAINT "tasks_parent_not_self_check" CHECK ("parent_task_id" <> "id");
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" ("parent_task_id")
  WHERE "parent_task_id" IS NOT NULL;

-- Parent chains may not loop and are limited in depth.
CREATE FUNCTION "prevent_task_parent_cycle"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  depth INTEGER;
BEGIN
  IF NEW."parent_task_id" IS NULL THEN
    RETURN NEW;
  END IF;
  WITH RECURSIVE chain AS (
    SELECT t."id", t."parent_task_id", 1 AS depth
    FROM "tasks" t WHERE t."id" = NEW."parent_task_id"
    UNION ALL
    SELECT t."id", t."parent_task_id", chain.depth + 1
    FROM "tasks" t JOIN chain ON t."id" = chain."parent_task_id"
    WHERE chain.depth < 20 AND chain."id" <> NEW."id"
  )
  SELECT max(chain.depth) INTO depth FROM chain;
  IF EXISTS (
    WITH RECURSIVE chain AS (
      SELECT t."id", t."parent_task_id", 1 AS depth
      FROM "tasks" t WHERE t."id" = NEW."parent_task_id"
      UNION ALL
      SELECT t."id", t."parent_task_id", chain.depth + 1
      FROM "tasks" t JOIN chain ON t."id" = chain."parent_task_id"
      WHERE chain.depth < 20
    )
    SELECT 1 FROM chain WHERE chain."id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'task parent would create a cycle'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tasks_parent_cycle_check';
  END IF;
  IF depth >= 5 THEN
    RAISE EXCEPTION 'task nesting is limited to 5 levels'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tasks_parent_depth_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "tasks_parent_cycle"
  BEFORE INSERT OR UPDATE OF "parent_task_id" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "prevent_task_parent_cycle"();

CREATE TRIGGER "labels_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "labels"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
