-- M6: scoped API tokens for scripts and integrations (ADR-037).
CREATE TABLE "api_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  -- The first characters, shown so people can tell tokens apart.
  "prefix" VARCHAR(16) NOT NULL,
  -- HMAC-SHA256 digest; the token itself is never stored.
  "token_hash" BYTEA NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "last_used_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "api_tokens_scopes_check" CHECK (
    cardinality("scopes") > 0 AND "scopes" <@ ARRAY['tasks:read', 'tasks:write']::TEXT[]),
  CONSTRAINT "api_tokens_membership_fkey"
    FOREIGN KEY ("organization_id", "user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
CREATE INDEX "api_tokens_owner_idx" ON "api_tokens" ("organization_id", "user_id");
CREATE TRIGGER "api_tokens_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "api_tokens"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
