-- Notification preferences per kind and daily digests (ADR-048).
ALTER TABLE "notification_settings"
  ADD COLUMN "email_mode" VARCHAR(8) NOT NULL DEFAULT 'instant',
  ADD COLUMN "muted_kinds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "last_digest_at" TIMESTAMPTZ(6);
UPDATE "notification_settings" SET "email_mode" = 'off' WHERE NOT "email_enabled";
ALTER TABLE "notification_settings" DROP COLUMN "email_enabled";
ALTER TABLE "notification_settings"
  ADD CONSTRAINT "notification_settings_email_mode_check"
    CHECK ("email_mode" IN ('instant', 'daily', 'off')),
  ADD CONSTRAINT "notification_settings_muted_check"
    CHECK ("muted_kinds" <@ ARRAY['task.assigned', 'comment.created', 'mention']::TEXT[]);
