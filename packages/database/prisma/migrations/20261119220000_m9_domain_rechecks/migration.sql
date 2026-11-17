-- Verified domains are re-checked daily (ADR-057).
ALTER TABLE "organization_domains" ADD COLUMN "checked_at" TIMESTAMPTZ(6);
ALTER TABLE "organization_domains" ADD COLUMN "failed_checks" INTEGER NOT NULL DEFAULT 0;
