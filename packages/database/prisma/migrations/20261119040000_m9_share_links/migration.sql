-- Public read-only share links for a project's task list (ADR-050).
CREATE TABLE "share_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  -- The first characters, shown so managers can tell links apart.
  "prefix" VARCHAR(16) NOT NULL,
  -- HMAC-SHA256 digest; the link token itself is never stored.
  "token_hash" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "last_used_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "share_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "share_links_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "share_links_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "share_links_creator_fkey"
    FOREIGN KEY ("organization_id", "created_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
CREATE INDEX "share_links_project_idx" ON "share_links" ("organization_id", "project_id");
CREATE TRIGGER "share_links_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "share_links"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
