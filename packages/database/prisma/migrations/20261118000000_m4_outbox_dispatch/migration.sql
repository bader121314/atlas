-- M4: outbox dispatch and the project event stream (ADR-028).

-- Events are streamed per project; the column replaces payload lookups.
ALTER TABLE "outbox_events" ADD COLUMN "project_id" UUID;
UPDATE "outbox_events" SET "project_id" = ("payload" ->> 'projectId')::uuid
  WHERE "payload" ? 'projectId';

-- When a delivery attempt failed, the dispatcher waits until this time.
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6);

-- Reconnecting browsers replay published events after their last one.
CREATE INDEX "outbox_events_stream_idx"
  ON "outbox_events" ("project_id", "published_at")
  WHERE "published_at" IS NOT NULL;
