-- M6: automation rules (ADR-038).

ALTER TABLE "outbox_events" ADD COLUMN "automations_at" TIMESTAMPTZ(6);
UPDATE "outbox_events" SET "automations_at" = CURRENT_TIMESTAMP;
CREATE INDEX "outbox_events_automations_idx"
  ON "outbox_events" ("occurred_at") WHERE "automations_at" IS NULL;

CREATE TABLE "automation_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  -- trigger: { type, toStateId? }; conditions: { priorities?, labelId?, unassigned? };
  -- actions: [{ type, ... }]. Validated by the API schema (ADR-038).
  "trigger" JSONB NOT NULL,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "actions" JSONB NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_rules_scope_key" UNIQUE ("organization_id", "project_id", "id"),
  CONSTRAINT "automation_rules_shape_check" CHECK (
    jsonb_typeof("trigger") = 'object' AND jsonb_typeof("conditions") = 'object'
    AND jsonb_typeof("actions") = 'array' AND jsonb_array_length("actions") BETWEEN 1 AND 5),
  CONSTRAINT "automation_rules_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "automation_rules_creator_membership_fkey"
    FOREIGN KEY ("organization_id", "created_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
CREATE INDEX "automation_rules_project_idx" ON "automation_rules" ("project_id") WHERE "enabled";

CREATE TABLE "automation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "detail" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id"),
  -- A rule runs at most once per event.
  CONSTRAINT "automation_runs_once_key" UNIQUE ("rule_id", "event_id"),
  CONSTRAINT "automation_runs_status_check"
    CHECK ("status" IN ('applied', 'skipped', 'failed')),
  CONSTRAINT "automation_runs_rule_fkey"
    FOREIGN KEY ("organization_id", "project_id", "rule_id")
    REFERENCES "automation_rules" ("organization_id", "project_id", "id") ON DELETE CASCADE
);
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" ("rule_id", "created_at" DESC);
CREATE TRIGGER "automation_rules_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "automation_rules"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
