# 01 — Product Requirements, UX and Design System

## Product vision and positioning

Atlas helps small and medium teams plan, execute and review work across organizations and projects without losing accountability. Distinguish from generic task trackers by combining an opinionated workflow engine, real-time team coordination, strong organizational permissions, and explainable reporting.

## Personas

- **Organization owner:** controls billing-ready organization settings, membership, security and retention.
- **Administrator:** manages teams, invites, project templates, permission policies.
- **Project manager:** plans, delegates, tracks milestones, dependencies and goals.
- **Contributor:** manages assignments, comments, time estimates, files, activity.
- **Guest:** tightly scoped project-level collaboration with no organization-wide discovery.
- **Auditor/read-only stakeholder:** permitted read access to reports and events within explicitly assigned scope.

## Functional requirements

IDs are durable references for issues/tests and should not be renumbered.

### Identity, organizations and permissions

- FR-001 Sign up, email verification, sign in/out, password recovery, MFA enrollment and device/session revocation.
- FR-002 Create, rename, archive, transfer ownership of and delete organizations with guarded irreversible flows.
- FR-003 Invite by email (single-use hashed expiring invite), resend, revoke; enforce intended email and state transitions.
- FR-004 Org roles owner/admin/member/guest plus project-scoped project_manager/editor/commenter/viewer; explicit role-to-action matrix.
- FR-005 Teams, team membership and project membership, with guest restrictions, ownership continuity and permission change audit.
- FR-006 Organization switcher, per-organization preferences, protected membership administration.

### Work management

- FR-010 CRUD projects and project templates with visibility private/team/org and archive state.
- FR-011 Custom workflow states with legal transitions; backlog, active, blocked, done default states.
- FR-012 CRUD tasks and subtasks; title, rich description, status, priority, assignee(s), reporter, tags, due date, estimate, watchers, custom fields.
- FR-013 Dependencies with directed graph cycle prevention, blocked completion rules and critical path visualization in a later iteration.
- FR-014 Task comments, edits, soft-delete, @mentions, reactions, attachments, activity and revision history.
- FR-015 Board, list, calendar, timeline, workload and personal 'My Work' views with saved filters, sort and paging.
- FR-016 Bulk actions, keyboard shortcuts, optimistic UI with server reconciliation and concurrency conflict resolution.
- FR-017 Milestones, recurring tasks, project health, progress indicators and overdue notifications.
- FR-018 Search by text, assignee, status, project, labels and date ranges with authorized filtering.

### Collaboration, automation, reporting, integrations

- FR-020 Realtime project/task changes, presence with TTL, cursor-independent collaborative awareness; not full CRDT document editing in baseline.
- FR-021 Notification inbox, email notifications, configurable preferences, digest and quiet hours.
- FR-022 Activity feeds and immutable security-relevant audit events.
- FR-023 Automation rules based on triggers/conditions/actions; versioning, quotas, retries, execution history and loop prevention.
- FR-024 Dashboard charts: cycle time, throughput, completion, workloads, overdue, activity; clear metric definitions.
- FR-025 CSV export/import with schema validation, dry-run preview, row errors and download expiry.
- FR-026 External personal/team integration tokens and webhooks with scopes, signatures, rotation, retries and delivery logs.
- FR-027 Project/organization file attachments with virus scanning, allowlist, access checks and signed URLs.
- FR-028 Organization usage, configurable retention, export/delete requests and privacy settings.
- FR-029 Global command palette, search, accessibility and user timezone/localization preferences (English first; Arabic RTL designed into tokens and layout in a later rollout).
- FR-030 Mobile-responsive experiences; PWA/offline read-cache optional, mutation offline queue explicitly out of scope until conflict strategy is defined.

## Explicit non-goals for initial release (not canceled)

Native iOS/Android apps, billing payments, enterprise SAML/SCIM, full collaborative rich-text CRDT, marketplace and AI assistant are later expansions. Interfaces and schema should accommodate future work without speculative overengineering.

## Primary user journeys

1. New user verifies email, creates org, invites colleague, creates first project and assigns a task.
2. Member accesses two separate orgs; cannot query org A data while using org B context.
3. Project manager edits a task; assignee receives realtime update and notification; audit entry exists.
4. Contributor uploads private attachment; unauthorized member cannot obtain download URL.
5. Admin defines automation 'when task becomes blocked, notify manager'; worker handles duplicate events once.
6. Manager reviews workload and applies saved filters; report numbers reconcile to underlying tasks.
7. User loses access while subscribed via WebSocket; subscription is disconnected/revoked.
8. Owner exports organization records; process is tracked, access-controlled and auditable.

## Design system

**Tone:** polished, precise, information-dense but calm, credible B2B product. Avoid generic gradient-heavy clone appearance.

- Color: neutrals with primary indigo/blue (#3159B8), success teal (#21806A), amber warnings (#B86B18), critical red (#C23B43); verify WCAG contrast, support dark mode with semantic tokens.
- Typography: UI sans with high legibility and optional monospace for metadata/IDs; type scale 12/14/16/20/24/32, line heights responsive; avoid using color alone for status.
- Spacing: 4px-based scale, minimum 44x44 target where practical for touch, dense desktop tables still keyboard-operable.
- Layout: global top bar, 240px collapsible nav, contextual side panel, flexible workspace canvas; adaptive breakpoints with no horizontal overflow for core flows.
- Components: app shell, org/project switchers, task cards, tables with virtualized rows when needed, modal/dialog, slideovers, command palette, filters, timeline, date picker, forms, avatars, badges, toasts, skeletons, empty/error states.
- Accessibility: keyboard navigation, visible focus, modal focus traps/restore, reduced motion, proper landmarks, clear live regions, contrast, semantics for drag-and-drop alternative controls.
- Performance: defer charts, use pagination/infinite loading for large sets, prevent expensive rendering of all tasks in boards, suspense/loading boundaries.

## Route and screen inventory

Public: `/`, `/features`, `/security`, `/sign-in`, `/sign-up`, `/verify-email`, `/recover`, `/invite/[token]`.
App: `/app`, `/app/[orgSlug]/overview`, `/app/[orgSlug]/my-work`, `/app/[orgSlug]/projects`, `/app/[orgSlug]/projects/[projectKey]/board`, `/list`, `/calendar`, `/timeline`, `/tasks/[taskKey]`, `/reports`, `/activity`, `/automations`, `/files`, `/settings/general`, `/settings/members`, `/settings/teams`, `/settings/security`, `/settings/integrations`, `/settings/audit`, `/me/profile`, `/me/notifications`, `/me/sessions`.

## Success measures and performance budgets (engineering targets, not established facts)

- 100% of documented cross-tenant isolation cases pass; 0 high/critical unresolved vulnerabilities at release.
- API p95 response for indexed task list under seed workload (100k tasks) < 300ms server-side excluding network; measure and revise.
- Realtime update median < 500ms in test environment, p95 < 2s with controlled load; graceful reconnect and resync.
- Monthly service availability SLO target 99.9% once operational monitoring and sufficient history exist.
- LCP p75 < 2.5s on representative connection/device; CLS < 0.1, INP < 200ms; report measured conditions.
- Critical workflow E2E coverage; no duplicate automation side effects after retries.
