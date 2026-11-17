-- M3: custom fields (ADR-026).
CREATE TABLE "custom_fields" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "type" TEXT NOT NULL,
  "options" JSONB NOT NULL DEFAULT '[]',
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_fields_scope_key" UNIQUE ("organization_id", "project_id", "id"),
  CONSTRAINT "custom_fields_project_fkey" FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "custom_fields_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "custom_fields_type_check" CHECK ("type" IN ('text', 'number', 'date', 'select')),
  CONSTRAINT "custom_fields_options_check" CHECK (
    jsonb_typeof("options") = 'array'
    AND (("type" = 'select') = (jsonb_array_length("options") > 0))
  )
);
CREATE UNIQUE INDEX "custom_fields_project_name_key"
  ON "custom_fields" ("project_id", lower("name"));

CREATE TABLE "task_field_values" (
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "field_id" UUID NOT NULL,
  "value_text" VARCHAR(500),
  "value_number" NUMERIC,
  "value_date" DATE,
  CONSTRAINT "task_field_values_pkey" PRIMARY KEY ("task_id", "field_id"),
  CONSTRAINT "task_field_values_task_fkey"
    FOREIGN KEY ("organization_id", "project_id", "task_id")
    REFERENCES "tasks" ("organization_id", "project_id", "id") ON DELETE CASCADE,
  CONSTRAINT "task_field_values_field_fkey"
    FOREIGN KEY ("organization_id", "project_id", "field_id")
    REFERENCES "custom_fields" ("organization_id", "project_id", "id") ON DELETE CASCADE,
  -- Exactly one typed column holds the value.
  CONSTRAINT "task_field_values_one_value_check" CHECK (
    num_nonnulls("value_text", "value_number", "value_date") = 1
  )
);
CREATE INDEX "task_field_values_field_idx" ON "task_field_values" ("field_id");

CREATE TRIGGER "custom_fields_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "custom_fields"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
