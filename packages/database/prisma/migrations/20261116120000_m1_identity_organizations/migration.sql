-- M1: identity, sessions and organization tenancy (ADR-010).
-- Status/role columns use TEXT + CHECK instead of PostgreSQL enums so values
-- can be added with an expand-only migration.

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email_normalized" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(100) NOT NULL,
  "locale" VARCHAR(35) NOT NULL DEFAULT 'en',
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "status" TEXT NOT NULL DEFAULT 'active',
  "password_hash" TEXT,
  "email_verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_normalized_key" UNIQUE ("email_normalized"),
  CONSTRAINT "users_email_normalized_check"
    CHECK ("email_normalized" = lower(btrim("email_normalized"))
      AND position('@' IN "email_normalized") > 1),
  CONSTRAINT "users_display_name_check"
    CHECK (length(btrim("display_name")) > 0),
  CONSTRAINT "users_status_check"
    CHECK ("status" IN ('active', 'disabled', 'deleted'))
);

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" BYTEA NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "ip_summary" VARCHAR(64),
  "user_agent_summary" VARCHAR(256),
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE CASCADE,
  -- HMAC-SHA256 digest of the opaque token; the raw token is never stored.
  CONSTRAINT "sessions_token_hash_check" CHECK (octet_length("token_hash") = 32),
  CONSTRAINT "sessions_expiry_check" CHECK ("expires_at" > "issued_at")
);
CREATE INDEX "sessions_user_id_revoked_at_idx"
  ON "sessions" ("user_id", "revoked_at");
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");

CREATE TABLE "verification_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "purpose" TEXT NOT NULL,
  "token_hash" BYTEA NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verification_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "verification_tokens_purpose_check"
    CHECK ("purpose" IN ('email_verification', 'password_reset')),
  CONSTRAINT "verification_tokens_token_hash_check"
    CHECK (octet_length("token_hash") = 32),
  CONSTRAINT "verification_tokens_expiry_check"
    CHECK ("expires_at" > "created_at")
);
CREATE INDEX "verification_tokens_user_id_purpose_idx"
  ON "verification_tokens" ("user_id", "purpose");

CREATE TABLE "organizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" VARCHAR(63) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "retention_days" INTEGER,
  "settings_json" JSONB NOT NULL DEFAULT '{}',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organizations_slug_key" UNIQUE ("slug"),
  CONSTRAINT "organizations_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id"),
  CONSTRAINT "organizations_slug_check"
    CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
      AND length("slug") >= 3),
  CONSTRAINT "organizations_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "organizations_status_check"
    CHECK ("status" IN ('active', 'suspended', 'deleted')),
  CONSTRAINT "organizations_retention_days_check"
    CHECK ("retention_days" IS NULL OR "retention_days" > 0),
  CONSTRAINT "organizations_settings_json_check"
    CHECK (jsonb_typeof("settings_json") = 'object')
);

CREATE TABLE "organization_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'active',
  "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_memberships_organization_id_user_id_key"
    UNIQUE ("organization_id", "user_id"),
  CONSTRAINT "organization_memberships_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
    ON DELETE RESTRICT,
  CONSTRAINT "organization_memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
  CONSTRAINT "organization_memberships_role_check"
    CHECK ("role" IN ('owner', 'admin', 'member', 'guest')),
  CONSTRAINT "organization_memberships_state_check"
    CHECK ("state" IN ('active', 'suspended', 'removed'))
);
CREATE INDEX "organization_memberships_user_id_idx"
  ON "organization_memberships" ("user_id");

CREATE TABLE "invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "email_normalized" VARCHAR(320) NOT NULL,
  "invited_by_user_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "token_hash" BYTEA NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invitations_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "invitations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
    ON DELETE RESTRICT,
  -- Composite tenant key: the inviter must be a member of the SAME
  -- organization, enforced by the database even if application code errs.
  CONSTRAINT "invitations_inviter_membership_fkey"
    FOREIGN KEY ("organization_id", "invited_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id")
    ON DELETE RESTRICT,
  -- Ownership is transferred, never granted by invitation.
  CONSTRAINT "invitations_role_check"
    CHECK ("role" IN ('admin', 'member', 'guest')),
  CONSTRAINT "invitations_email_normalized_check"
    CHECK ("email_normalized" = lower(btrim("email_normalized"))
      AND position('@' IN "email_normalized") > 1),
  CONSTRAINT "invitations_token_hash_check"
    CHECK (octet_length("token_hash") = 32),
  CONSTRAINT "invitations_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "invitations_single_outcome_check"
    CHECK ("accepted_at" IS NULL OR "revoked_at" IS NULL)
);
-- At most one outstanding invitation per organization and email. Expired but
-- unrevoked invitations still count; the application revokes before reissuing.
CREATE UNIQUE INDEX "invitations_outstanding_key"
  ON "invitations" ("organization_id", "email_normalized")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- Every live organization must keep at least one active owner. Checked at
-- COMMIT (deferred) so ownership transfer can happen inside one transaction.
CREATE FUNCTION "assert_organization_has_active_owner"(org_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "organizations" o
    WHERE o."id" = org_id AND o."status" <> 'deleted'
  ) AND NOT EXISTS (
    SELECT 1 FROM "organization_memberships" m
    WHERE m."organization_id" = org_id
      AND m."role" = 'owner' AND m."state" = 'active'
  ) THEN
    RAISE EXCEPTION 'organization must keep an active owner'
      USING ERRCODE = 'check_violation',
        CONSTRAINT = 'organizations_active_owner_check';
  END IF;
END;
$$;

CREATE FUNCTION "organizations_active_owner_trigger"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "assert_organization_has_active_owner"(NEW."id");
  RETURN NULL;
END;
$$;

CREATE FUNCTION "memberships_active_owner_trigger"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "assert_organization_has_active_owner"(OLD."organization_id");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "organizations_active_owner"
  AFTER INSERT OR UPDATE OF "status" ON "organizations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "organizations_active_owner_trigger"();

CREATE CONSTRAINT TRIGGER "organization_memberships_active_owner"
  AFTER UPDATE OR DELETE ON "organization_memberships"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "memberships_active_owner_trigger"();

-- Tenant keys are immutable once written.
CREATE FUNCTION "prevent_tenant_key_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id" THEN
    RAISE EXCEPTION 'organization_id is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "organization_memberships_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "organization_memberships"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();

CREATE TRIGGER "invitations_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "invitations"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
