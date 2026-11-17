-- Estimates and weekly capacity for workload planning (ADR-054).
ALTER TABLE "tasks" ADD COLUMN "estimate_minutes" INTEGER;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_estimate_minutes_check"
  CHECK ("estimate_minutes" IS NULL OR "estimate_minutes" BETWEEN 1 AND 60000);
ALTER TABLE "organization_memberships" ADD COLUMN "weekly_capacity_minutes" INTEGER;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_capacity_check"
  CHECK ("weekly_capacity_minutes" IS NULL OR "weekly_capacity_minutes" BETWEEN 0 AND 10080);
