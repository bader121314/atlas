# 04 — REST API, Real-Time Events, and Integration Contracts

## Global contract rules

Base `/v1`; JSON UTF-8; OpenAPI 3.1 source-of-truth generated or contract-first with drift CI; all dates ISO-8601 UTC; UUIDs; pagination by stable opaque cursor; standardized UTC. Use RFC 9457 Problem Details (`application/problem+json`) for errors, including `type`, `title`, `status`, `detail`, `instance`, `code`, `requestId`, optional field issues; never leak internal exceptions. Authentication uses first-party session cookie and CSRF token/protection for mutating requests. `Idempotency-Key` required for create operations involving invitations, exports, integrations and other retry-sensitive actions. Entity `ETag`/`If-Match` or `expectedVersion` for concurrent task changes. Response envelope for lists `{items, pageInfo:{nextCursor,hasNextPage}, totalApprox?}`; limit defaults to 25, max 100. No universal successful response wrapper necessary.

## Endpoint inventory (implementation contract)

### Auth and identity

`POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `POST /auth/mfa/enroll`, `POST /auth/mfa/verify`, `POST /auth/mfa/disable`, `GET /auth/sessions`, `DELETE /auth/sessions/{sessionId}`, `GET /me`, `PATCH /me`, `GET /me/security`.
Public unauthenticated routes are specifically allowlisted; login and recovery have abuse controls.

### Organization, teams, projects

`POST /organizations`, `GET /organizations`, `GET/PATCH/DELETE /organizations/{orgId}`, `POST /organizations/{orgId}/transfer-ownership`, `GET /organizations/{orgId}/members`, `PATCH/DELETE /organizations/{orgId}/members/{userId}`, `POST /organizations/{orgId}/invitations`, `GET /organizations/{orgId}/invitations`, `POST /invitations/{token}/accept`, `DELETE /organizations/{orgId}/invitations/{id}`, `GET/POST /organizations/{orgId}/teams`, `GET/PATCH/DELETE /organizations/{orgId}/teams/{teamId}`, `PUT/DELETE /organizations/{orgId}/teams/{teamId}/members/{userId}`.
`GET/POST /organizations/{orgId}/projects`, `GET/PATCH/DELETE /organizations/{orgId}/projects/{projectId}`, `GET/POST /organizations/{orgId}/projects/{projectId}/members`, `PATCH/DELETE /organizations/{orgId}/projects/{projectId}/members/{userId}`, `GET/POST /organizations/{orgId}/workflows`, `GET/PATCH /organizations/{orgId}/workflows/{workflowId}`.

### Tasks and collaboration

`GET/POST /organizations/{orgId}/projects/{projectId}/tasks`, `GET/PATCH/DELETE /organizations/{orgId}/projects/{projectId}/tasks/{taskId}`; separate safe actions `POST /tasks/{taskId}/transition`, `POST /tasks/{taskId}/move`, `PUT /tasks/{taskId}/assignees`, `POST /tasks/{taskId}/dependencies`, `DELETE /tasks/{taskId}/dependencies/{dependencyId}` all under org/project prefix. `GET/POST /tasks/{taskId}/comments`, `PATCH/DELETE /tasks/{taskId}/comments/{commentId}`, `GET /tasks/{taskId}/activity`, `POST /tasks/bulk` with validated per-item errors and guarded limits. `GET /organizations/{orgId}/my-work`, `GET /organizations/{orgId}/search`, `GET/POST /organizations/{orgId}/saved-views`.

### Files, notifications, reporting, rules

`POST /attachments/upload-intents`, `POST /attachments/{id}/complete`, `GET /attachments/{id}/download-intent`, `DELETE /attachments/{id}`; upload complete triggers scan, not immediate trust.
`GET /organizations/{orgId}/notifications`, `PATCH /notifications/{id}/read`, `GET/PATCH /me/notification-preferences`.
`GET /organizations/{orgId}/reports/overview`, `/workload`, `/cycle-time`, `/throughput` with time window, scope and metric definition metadata.
`GET/POST /organizations/{orgId}/automations`, `GET/PATCH/DELETE /automations/{id}`, `GET /automations/{id}/executions`, `POST /automations/{id}/dry-run`.
`GET/POST /organizations/{orgId}/webhooks`, `POST /webhooks/{id}/rotate-secret`, `DELETE /webhooks/{id}`, `GET /webhooks/{id}/deliveries`; `GET/POST/DELETE /organizations/{orgId}/tokens`; `POST/GET /organizations/{orgId}/exports`, `POST /organizations/{orgId}/imports`.

## Example task creation

Request `POST /v1/organizations/{orgId}/projects/{projectId}/tasks`:

```json
{
  "title": "Finish onboarding workflow",
  "description": { "type": "doc", "content": [] },
  "stateId": "019abcde-0000-7000-8000-000000000011",
  "priority": "high",
  "assigneeIds": ["019abcde-0000-7000-8000-000000000021"],
  "dueAt": "2027-01-12T12:00:00Z"
}
```

Response `201 Created`, `Location`, JSON `{id,key,organizationId,projectId,title,stateId,priority,version,createdAt,...}`; server derives org from validated path and authenticated membership. Never accept arbitrary organizationId from body.

## Example task update with conflict protection

`PATCH .../tasks/{taskId}` request header `If-Match: "7"`, body `{ "title":"Revised title" }`. On success `200`, header `ETag: "8"`; on concurrent modification `412 Precondition Failed` with problem code `VERSION_CONFLICT`. Missing version precondition `428 Precondition Required` for defined collaborative mutations. Input rejection `422` with field-level errors; resource outside authorization scope use consistent `404` to avoid information enumeration.

## Permissions and idempotency

- `Idempotency-Key` stored with `(user/org,method,resource,key,body_hash,status,response)` limited TTL; same key/different body returns conflict.
- Return 429 with Retry-After for rate limits.
- Explicit capabilities `org.member.invite`, `org.settings.update`, `project.create`, `task.read`, `task.write`, `task.delete`, `automation.manage`, `audit.read`, `integration.manage`, `report.read`; policy takes actor, org, resource and action.
- A list API must filter unauthorized rows in database query, not filter after pagination.
- Integration API tokens require scopes and expiry, hashed at rest, revocable. No browser access to API keys.

## WebSocket contract

Endpoint `wss://api.../v1/realtime`. Authenticate via established same-site cookie with allowed origin and CSRF-aware handshake or an approved short-lived single-use token minted via authenticated endpoint (prefer latter where origins differ). Client sends `subscribe` `{organizationId,projectId,lastEventCursor?}`. Server checks org+project authorization and caps room subscriptions. Events: `task.created`, `task.updated`, `task.deleted`, `comment.created`, `member.changed`, `project.updated`, `notification.created`, `presence.changed`; envelope `{eventId, type, organizationId, resourceId, version, occurredAt, payload}` with minimal payload and no sensitive secrets. On access revocation disconnect room immediately or on next revalidation; never trust room ID provided by client. Redis adapter coordinates multiple gateway instances. Missed event or cursor-expiry -> full API resync.

## Webhooks

Signed with HMAC-SHA256 secret and `X-Atlas-Timestamp`, `X-Atlas-Signature`, `X-Atlas-Event-Id`; verification guidance includes replay window and constant-time comparison. Deliver at least once with exponential backoff and capped retries, log attempt/status, automatically pause repeatedly failing endpoints, use allowlists/protection against SSRF and private-network destinations. Document eventual consistency.

## Example Problem Details

```json
{
  "type": "https://docs.atlas.example/errors/version-conflict",
  "title": "Task was modified by another collaborator",
  "status": 412,
  "code": "VERSION_CONFLICT",
  "detail": "Reload and reconcile the task before submitting again.",
  "requestId": "req_123456789"
}
```

## API contract test obligations

Generate typed clients from the OpenAPI spec; test all endpoints with success, unauthenticated, insufficient permission, foreign org, invalid body, nonexistent ID, and relevant conflict/retry cases. Include backwards compatibility checks and no accidental public endpoints.
