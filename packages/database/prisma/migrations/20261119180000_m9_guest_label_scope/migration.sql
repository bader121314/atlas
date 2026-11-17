-- Attribute-based guest access (ADR-059): a guest's project membership can
-- be limited to tasks carrying any of these labels. NULL means every task.
ALTER TABLE "project_memberships" ADD COLUMN "label_scope" UUID[];
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_label_scope_check"
  CHECK ("label_scope" IS NULL OR cardinality("label_scope") <= 20);
