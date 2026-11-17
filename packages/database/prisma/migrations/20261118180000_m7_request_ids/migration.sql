-- M7: audit events record the request that caused them.
ALTER TABLE "audit_events" ADD COLUMN "request_id" VARCHAR(128);
