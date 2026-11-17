-- Email domains an organization has proven it controls (ADR-057).
CREATE TABLE "organization_domains" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "domain" VARCHAR(253) NOT NULL,
  "verification_token" VARCHAR(64) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_at" TIMESTAMPTZ(6),
  CONSTRAINT "organization_domains_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_domains_domain_check"
    CHECK ("domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  CONSTRAINT "organization_domains_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
  CONSTRAINT "organization_domains_creator_fkey"
    FOREIGN KEY ("organization_id", "created_by_user_id")
    REFERENCES "organization_memberships" ("organization_id", "user_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "organization_domains_org_domain_key"
  ON "organization_domains" ("organization_id", "domain");
-- A domain can be verified by one organization at a time.
CREATE UNIQUE INDEX "organization_domains_verified_key"
  ON "organization_domains" ("domain") WHERE "verified_at" IS NOT NULL;
CREATE TRIGGER "organization_domains_tenant_immutable"
  BEFORE UPDATE OF "organization_id" ON "organization_domains"
  FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_key_change"();
