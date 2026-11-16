-- M2: projects and project memberships (ADR-018).
CREATE TABLE "projects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "key" VARCHAR(10) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(2000) NOT NULL DEFAULT '',
  "visibility" TEXT NOT NULL DEFAULT 'organization',
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_by_user_id" UUID NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projects_organization_id_id_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "projects_organization_id_key_key" UNIQUE ("organization_id", "key"),
  CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations" ("id") ON DELETE RESTRICT,
  CONSTRAINT "projects_creator_membership_fkey"
    FOREIGN KEY ("organization_id", "created_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id"),
  CONSTRAINT "projects_key_check" CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
  CONSTRAINT "projects_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "projects_visibility_check"
    CHECK ("visibility" IN ('organization', 'private')),
  CONSTRAINT "projects_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "projects_version_check" CHECK ("version" > 0)
);

CREATE TABLE "project_memberships" (
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("project_id", "user_id"),
  -- Both keys carry organization_id, so a project in one organization can
  -- never list a member of another.
  CONSTRAINT "project_memberships_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "project_memberships_member_fkey"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id"),
  CONSTRAINT "project_memberships_role_check"
    CHECK ("role" IN ('manager', 'editor', 'commenter', 'viewer'))
);
CREATE INDEX "project_memberships_organization_id_user_id_idx"
  ON "project_memberships" ("organization_id", "user_id");

CREATE TRIGGER "projects_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "projects"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
CREATE TRIGGER "project_memberships_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "project_memberships"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
