# 03 — Data Model, Constraints and Multi-Tenant Isolation

## Conventions

All tenant-scoped rows have immutable `organization_id` and UUID primary key; FK consistency must prevent cross-org linking. Timestamps `created_at`, `updated_at` in UTC `timestamptz`, `deleted_at` where recoverable. Use database constraints, explicit unique keys, carefully designed delete policies, normalized tables, deterministic migrations and index review. User-level entities are global only when intended (users, sessions, authenticators); an organization's access never derives from user identity alone.

## Canonical tables and key columns

Notation: `PK`, `FK`, `UQ`, `IDX`; all omitted conventional timestamps still apply.

### Identity and organization

- `users`: id PK, email_normalized UQ, display_name, avatar_key, locale, timezone, email_verified_at, status, password_hash nullable (for SSO-only future), created_at; normalize email for lookup but do not assume arbitrary provider alias equivalence.
- `sessions`: id PK, user_id FK, token_hash UQ, issued_at, expires_at, last_seen_at, revoked_at, ip_summary, user_agent_summary; indexes (user_id, revoked_at), expires_at.
- `authenticators`: id PK, user_id FK, kind enum, encrypted_secret, created_at, confirmed_at, revoked_at; one active TOTP per user policy.
- `recovery_codes`: id PK, user_id FK, code_hash, consumed_at.
- `verification_tokens`: id PK, user_id FK, purpose, token_hash UQ, expires_at, used_at.
- `organizations`: id PK, slug UQ, name, owner_user_id FK, retention_days, status, settings_json, created_at.
- `organization_memberships`: id PK, organization_id FK, user_id FK, role, state, joined_at, UQ(org_id,user_id); role CHECK.
- `invitations`: id PK, organization_id FK, email_normalized, invited_by FK, role, token_hash UQ, expires_at, accepted_at, revoked_at, UQ index for active outstanding invitation policy.
- `teams`: id PK, org_id FK, name, slug, UQ(org_id,slug).
- `team_members`: org_id, team_id, user_id, role, UQ(team_id,user_id), compound FKs ensuring same org.
- `projects`: id PK, org_id FK, key, name, description, visibility, status, created_by, workflow_id, version, UQ(org_id,key).
- `project_memberships`: org_id, project_id, user_id, role, UQ(project_id,user_id), compound FKs.

### Planning and tasks

- `workflows`: id PK, org_id FK, name, version, is_default; UQ(org_id,name).
- `workflow_states`: id PK, org_id FK, workflow_id FK, key, label, category, color_token, order_position; UQ(workflow_id,key).
- `workflow_transitions`: org_id, workflow_id, from_state_id, to_state_id, required_permission, UQ(workflow_id,from_state_id,to_state_id).
- `tasks`: id PK, org_id FK, project_id FK, key (human ID), title, description_json, state_id FK, priority, reporter_id, due_at, start_at, estimate_minutes, completed_at, rank, version bigint default 1, parent_task_id nullable, deleted_at; UQ(project_id,key); IDX(org_id,project_id,state_id,rank), IDX(org_id,due_at), IDX(org_id,updated_at).
- `task_assignees`: org_id, task_id, user_id, UQ(task_id,user_id).
- `task_dependencies`: org_id, predecessor_task_id, successor_task_id, dependency_type, UQ(predecessor_task_id,successor_task_id), check not equal; cross-project policy explicit.
- `labels`: id PK, org_id FK, name, color_token, UQ(org_id,name).
- `task_labels`: org_id, task_id, label_id, UQ(task_id,label_id).
- `task_custom_field_definitions`: id PK, org_id, project_id nullable, name, type, validation_json, version.
- `task_custom_field_values`: org_id, task_id, field_id, typed_value_*; unique(task_id,field_id); validate data type in application and DB where feasible.
- `task_comments`: id PK, org_id, project_id, task_id, author_id, body_json, edited_at, deleted_at, version.
- `comment_reactions`: org_id, comment_id, user_id, emoji_code, UQ(comment_id,user_id,emoji_code).
- `task_watchers`: org_id, task_id, user_id, UQ(task_id,user_id).
- `milestones`: id PK, org_id, project_id, title, due_at, status.
- `task_recurrence_rules`: id PK, org_id, task_template_id, schedule_expression, timezone, next_run_at, active, last_generated_at; unique occurrence key for generation.
- `saved_views`: id PK, org_id, owner_id, project_id nullable, visibility, filters_json (validated schema), sort_json, columns_json.

### Collaboration, operations and reporting

- `attachments`: id PK, org_id, project_id, task_id nullable, uploader_id, object_key UQ, original_name, mime_declared, mime_detected, size_bytes, sha256, scan_status, state, deleted_at.
- `activity_events`: id PK, org_id, aggregate_type, aggregate_id, actor_id nullable, action, sanitized_changes_json, occurred_at; append-only application policy.
- `audit_events`: id PK, org_id nullable, actor_id nullable, action, target_type, target_id, ip_summary, request_id, metadata_sanitized_json, occurred_at; retention and tamper-resistance controls.
- `notifications`: id PK, org_id, recipient_id, kind, title, body_safe, entity_ref, read_at, delivered_at, dedupe_key; IDX(recipient_id,read_at,created_at).
- `notification_preferences`: user_id, org_id nullable, channel, event_kind, enabled, digest_schedule, quiet_hours_json.
- `automation_rules`: id PK, org_id, project_id nullable, version, trigger_kind, condition_json, action_json, enabled, created_by, quota_class.
- `automation_executions`: id PK, org_id, rule_id, source_event_id, status, attempts, result_json, error_safe, UQ(rule_id,source_event_id).
- `outbox_events`: id PK, org_id nullable, aggregate_type, aggregate_id, aggregate_version, event_type, payload_json, occurred_at, published_at nullable, attempt_count; IDX(published_at,occurred_at).
- `consumer_receipts`: consumer_name, event_id, processed_at, UQ(consumer_name,event_id).
- `webhook_endpoints`: id PK, org_id, target_url, signing_secret_ciphertext, allowed_events, status.
- `webhook_deliveries`: id PK, org_id, webhook_id, event_id, attempt, response_status, next_attempt_at, delivered_at, error_safe, UQ(webhook_id,event_id,attempt).
- `api_tokens`: id PK, org_id, created_by, name, token_hash UQ, scopes_json, expires_at, revoked_at, last_used_at.
- `imports_exports`: id PK, org_id, requester_id, kind, format, object_key, state, summary_json, expires_at.
- `usage_counters`: org_id, metric, period_start, count, UQ(org_id,metric,period_start).

## Isolation mechanism: required layered defenses

1. Auth middleware identifies user from verified session, never from request-supplied user ID.
2. Route resolves organization via slug/ID and validates active membership.
3. Policy checks project visibility + explicit project/team assignment + action permissions.
4. Every tenant query includes organization boundary; nested joins and IDs require relationship verification.
5. Compound database uniqueness/FKs on `(organization_id, id)` for tenant entities and children to block cross-tenant references even under application mistakes.
6. Optional PostgreSQL RLS as defense in depth after connection-pooling safety is established; if used, set tenant identity via `SET LOCAL` within transaction and test fail-closed/no leakage between pooled connections. RLS must never replace application authorization.
7. Integration tokens and queued jobs carry verified org context as immutable signed/internal provenance; workers re-check rights for time-sensitive sensitive operations.
8. All indexes and caches include appropriate tenant boundary.

## Important integrity constraints

- Organization must retain at least one active owner. Ownership transfer and member deletion are transactional.
- A task's parent and all dependencies must belong to permitted project/org. Prevent parent cycles and dependency cycles.
- Task status must belong to project's workflow. Illegal transitions denied according to policy.
- Every comment, attachment and task assignee references a tenant-consistent task/member.
- Use non-cascading deletion for security/audit records; retention/legal policy explicit. Hard-delete user content via staged job with audit trace and privacy considerations.
- Implement optimistic concurrency via `tasks.version` and update `WHERE id=:task AND org_id=:org AND version=:expected`, checking affected row count.

## Sample transactional mutation

```
BEGIN;
UPDATE tasks SET title=:title, version=version+1, updated_at=NOW()
 WHERE id=:task_id AND organization_id=:org_id AND version=:expected_version;
-- require exactly one row, else conflict
INSERT INTO activity_events (... sanitized summary ...);
INSERT INTO outbox_events (id, organization_id, aggregate_type, aggregate_id,
 aggregate_version, event_type, payload_json, occurred_at) VALUES (...);
COMMIT;
```

## Migrations and index hygiene

- Maintain backward-compatible expand/migrate/contract rollout patterns.
- Never run destructive migrations automatically on production deploy without approval and backups.
- Review `EXPLAIN (ANALYZE, BUFFERS)` for top 10 hot queries; maintain migration test that runs from blank database and prior release schema.
- Generate seed data in test/local environments: two+ organizations, intersecting users, 100k benchmark task fixture, and explicit denied access fixtures.
