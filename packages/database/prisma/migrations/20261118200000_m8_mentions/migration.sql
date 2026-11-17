-- M8: mention notifications (ADR-045).
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('task.assigned', 'comment.created', 'mention'));
