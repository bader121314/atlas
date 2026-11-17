-- Single sign-on with OpenID Connect (ADR-058).
CREATE TABLE "sso_connections" (
  "organization_id" UUID NOT NULL,
  "issuer" VARCHAR(500) NOT NULL,
  "client_id" VARCHAR(255) NOT NULL,
  -- AES-256-GCM sealed with SSO_SECRET_KEY; never returned by the API.
  "client_secret_sealed" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "require_sso" BOOLEAN NOT NULL DEFAULT false,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "sso_connections_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
  CONSTRAINT "sso_connections_require_check" CHECK (NOT "require_sso" OR "enabled")
);

-- One sign-in attempt between the redirect to the provider and its return.
CREATE TABLE "sso_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "state_hash" BYTEA NOT NULL,
  "organization_id" UUID NOT NULL,
  "nonce" VARCHAR(64) NOT NULL,
  "code_verifier" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sso_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sso_states_state_hash_key" UNIQUE ("state_hash"),
  CONSTRAINT "sso_states_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE
);
CREATE INDEX "sso_states_expires_idx" ON "sso_states" ("expires_at");
