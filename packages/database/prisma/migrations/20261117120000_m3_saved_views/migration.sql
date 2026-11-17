-- M3: saved views (ADR-025).
CREATE TABLE "saved_views" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saved_views_project_fkey" FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "saved_views_owner_membership_fkey"
    FOREIGN KEY ("organization_id", "owner_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id"),
  CONSTRAINT "saved_views_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "saved_views_config_check" CHECK (jsonb_typeof("config") = 'object')
);
CREATE UNIQUE INDEX "saved_views_owner_name_key"
  ON "saved_views" ("project_id", "owner_user_id", lower("name"));
CREATE INDEX "saved_views_organization_id_project_id_idx"
  ON "saved_views" ("organization_id", "project_id");
CREATE TRIGGER "saved_views_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "saved_views"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
