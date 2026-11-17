-- M5: full-text search over tasks and comments (ADR-032).
-- The 'simple' configuration lowercases and splits words without stemming,
-- so it treats English, Arabic and mixed text the same way.

ALTER TABLE "tasks" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B')
  ) STORED;
CREATE INDEX "tasks_search_idx" ON "tasks" USING GIN ("search_vector");

ALTER TABLE "task_comments" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("body", ''))) STORED;
CREATE INDEX "task_comments_search_idx" ON "task_comments" USING GIN ("search_vector");
