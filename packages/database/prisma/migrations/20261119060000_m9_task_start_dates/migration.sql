-- Start dates for the timeline view (ADR-052). A task may have a start,
-- a due date, both or neither; when both are set the start is not later.
ALTER TABLE "tasks" ADD COLUMN "start_at" TIMESTAMPTZ(6);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_start_before_due_check"
  CHECK ("start_at" IS NULL OR "due_at" IS NULL OR "start_at" <= "due_at");
