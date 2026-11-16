// Project-level access (ADR-018). Organization role sets a baseline, an
// explicit project membership can refine it, and guests only ever see
// projects they are explicitly added to.
export const PROJECT_ROLES = [
  'manager',
  'editor',
  'commenter',
  'viewer',
] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_ACTIONS = [
  'project.read',
  'project.update',
  'project.members.manage',
  'task.read',
  'task.write',
  'task.comment',
] as const;
export type ProjectAction = (typeof PROJECT_ACTIONS)[number];

const GRANTS: Record<ProjectAction, readonly ProjectRole[]> = {
  'project.read': ['manager', 'editor', 'commenter', 'viewer'],
  'project.update': ['manager'],
  'project.members.manage': ['manager'],
  'task.read': ['manager', 'editor', 'commenter', 'viewer'],
  'task.write': ['manager', 'editor'],
  'task.comment': ['manager', 'editor', 'commenter'],
};

const RANK: Record<ProjectRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  manager: 3,
};

export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}

/**
 * The caller's effective role in a project, or undefined for no access.
 * - Organization owners and admins manage every project, private included.
 * - Members get `editor` on organization-visible projects unless an explicit
 *   project role says otherwise; private projects need explicit membership.
 * - Guests need explicit membership and are capped at `commenter`, so a
 *   project role can never lift a guest to editing.
 */
export function effectiveProjectRole(
  organizationRole: string,
  visibility: string,
  explicit: string | undefined,
): ProjectRole | undefined {
  const assigned = explicit && isProjectRole(explicit) ? explicit : undefined;
  switch (organizationRole) {
    case 'owner':
    case 'admin':
      return 'manager';
    case 'member':
      return assigned ?? (visibility === 'organization' ? 'editor' : undefined);
    case 'guest':
      if (!assigned) return undefined;
      return RANK[assigned] > RANK.commenter ? 'commenter' : assigned;
    default:
      return undefined;
  }
}

export function canProject(role: ProjectRole, action: ProjectAction): boolean {
  return GRANTS[action].includes(role);
}
