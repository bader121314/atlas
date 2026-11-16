-- M1: append-only security audit log (ADR-014).
-- No foreign keys on purpose: audit history must outlive the users,
-- organizations and sessions it mentions, and must never block their removal.
CREATE TABLE "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID,
  "actor_user_id" UUID,
  "action" VARCHAR(64) NOT NULL,
  "target_type" VARCHAR(32),
  "target_id" UUID,
  "ip_summary" VARCHAR(64),
  "user_agent_summary" VARCHAR(256),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
  -- Dotted lowercase names such as auth.login.succeeded.
  CONSTRAINT "audit_events_action_check"
    CHECK ("action" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  CONSTRAINT "audit_events_target_check"
    CHECK (("target_type" IS NULL) = ("target_id" IS NULL)),
  CONSTRAINT "audit_events_metadata_check"
    CHECK (jsonb_typeof("metadata") = 'object')
);
CREATE INDEX "audit_events_actor_user_id_occurred_at_idx"
  ON "audit_events" ("actor_user_id", "occurred_at" DESC);
CREATE INDEX "audit_events_organization_id_occurred_at_idx"
  ON "audit_events" ("organization_id", "occurred_at" DESC);
CREATE INDEX "audit_events_action_occurred_at_idx"
  ON "audit_events" ("action", "occurred_at" DESC);

-- Append-only: the application role can insert but never rewrite history.
-- Retention purges will run through a dedicated, audited maintenance path.
CREATE FUNCTION "audit_events_append_only"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();

CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_append_only"();
