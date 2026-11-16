# ADR-018: Projects and project roles

## Decisions

- **Projects live under the tenant URL:** `/v1/organizations/{slug}/projects/{key}`.
  Keys are 2–10 uppercase characters, unique per organization (the same key
  can exist in two organizations; they are unrelated projects).
- **Effective role = organization role + optional project role**
  (`projects/policy.ts`, pinned by `tests/project-policy.test.ts`):
  - owners and admins manage every project, private ones included;
  - members get `editor` on organization-visible projects and need an
    explicit project role for private ones; an explicit role overrides the
    default (it can also lower it);
  - guests need an explicit role and are capped at `commenter`, and the API
    refuses to assign them `editor` or `manager`.
- **Second guard.** `ProjectGuard` runs after `TenantGuard`, resolves the key
  inside the caller's organization, and applies the same rule: no access is
  404, insufficient role is 403. Routes declare a project permission or are
  rejected.
- **Composite tenant keys.** `projects (organization_id, id)` is unique;
  `project_memberships` references both the project and the organization
  membership through `organization_id`, so cross-organization links are
  impossible in the database. Tenant keys are immutable (trigger).
- **Optimistic concurrency.** Updates carry the `version` the client last saw;
  the update is `WHERE id AND organization_id AND version`, and a stale version
  returns 409. Archiving is an update (`status = archived`).
- **Audit:** `project.created`, `project.updated`, `project.member.set`,
  `project.member.removed`.
