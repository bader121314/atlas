-- Browser push notifications (ADR-060).
CREATE TABLE "push_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "endpoint" VARCHAR(1000) NOT NULL,
  "p256dh" VARCHAR(100) NOT NULL,
  "auth" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_success_at" TIMESTAMPTZ(6),
  "failures" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint"),
  CONSTRAINT "push_subscriptions_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

-- Existing notifications are never pushed; new ones wait for the push loop.
ALTER TABLE "notifications" ADD COLUMN "push_status" VARCHAR(16) NOT NULL DEFAULT 'skipped';
ALTER TABLE "notifications" ALTER COLUMN "push_status" SET DEFAULT 'pending';
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_push_status_check"
  CHECK ("push_status" IN ('pending', 'sent', 'skipped'));
CREATE INDEX "notifications_push_pending_idx" ON "notifications" ("created_at")
  WHERE "push_status" = 'pending';
