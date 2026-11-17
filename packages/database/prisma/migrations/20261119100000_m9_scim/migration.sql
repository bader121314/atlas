-- SCIM 2.0 user provisioning (ADR-055).
CREATE TABLE "scim_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "prefix" VARCHAR(16) NOT NULL,
  -- HMAC-SHA256 digest; the token itself is never stored.
  "token_hash" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scim_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "scim_tokens_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
  CONSTRAINT "scim_tokens_creator_fkey"
    FOREIGN KEY ("organization_id", "created_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
CREATE INDEX "scim_tokens_organization_idx" ON "scim_tokens" ("organization_id");
CREATE TRIGGER "scim_tokens_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "scim_tokens"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();

-- The identity provider's own id for the person, unique per organization.
ALTER TABLE "organization_memberships" ADD COLUMN "scim_external_id" VARCHAR(256);
CREATE UNIQUE INDEX "organization_memberships_scim_external_id_key"
  ON "organization_memberships" ("organization_id", "scim_external_id")
  WHERE "scim_external_id" IS NOT NULL;
