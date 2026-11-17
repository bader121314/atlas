// Deny-by-default organization policy (docs/05). Every tenant route names one
// action; a role may perform it only if listed here. Project-level roles will
// extend this in M2 and may never grant owner-only actions.
export const ORGANIZATION_ROLES = [
  'owner',
  'admin',
  'member',
  'guest',
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_ACTIONS = [
  'organization.read',
  'organization.update',
  'members.read',
  'members.invite',
  'members.manage',
  'projects.create',
  'labels.manage',
  'labels.delete',
  'webhooks.manage',
  'audit.read',
  'scim.manage',
  'usage.read',
] as const;
export type OrganizationAction = (typeof ORGANIZATION_ACTIONS)[number];

const GRANTS: Record<OrganizationAction, readonly OrganizationRole[]> = {
  'organization.read': ['owner', 'admin', 'member', 'guest'],
  'organization.update': ['owner', 'admin'],
  'members.read': ['owner', 'admin', 'member'],
  'members.invite': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'projects.create': ['owner', 'admin', 'member'],
  'labels.manage': ['owner', 'admin', 'member'],
  'labels.delete': ['owner', 'admin'],
  'webhooks.manage': ['owner', 'admin'],
  // The audit log names people and networks; owners and admins only (ADR-051).
  'audit.read': ['owner', 'admin'],
  // SCIM tokens add and remove members without review (ADR-055).
  'scim.manage': ['owner'],
  'usage.read': ['owner', 'admin'],
};

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function can(role: string, action: OrganizationAction): boolean {
  return isOrganizationRole(role) && GRANTS[action].includes(role);
}

// Roles an admin may grant or manage. Admins can never create admins or
// owners, or act on them: only owners can change privileged roles.
const ADMIN_MANAGEABLE: readonly OrganizationRole[] = ['member', 'guest'];

/** Whether `actor` may invite someone with `role` (never owner, ADR-010). */
export function canInviteAs(actor: string, role: string): boolean {
  if (role === 'owner' || !isOrganizationRole(role)) return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && ADMIN_MANAGEABLE.includes(role);
}

/** Whether `actor` may change a member from `current` to `next`. */
export function canChangeRole(
  actor: string,
  current: string,
  next: string,
): boolean {
  if (!isOrganizationRole(current) || !isOrganizationRole(next)) return false;
  if (actor === 'owner') return true;
  return (
    actor === 'admin' &&
    ADMIN_MANAGEABLE.includes(current) &&
    ADMIN_MANAGEABLE.includes(next)
  );
}

/** Whether `actor` may remove a member with `target` role. Anyone may leave. */
export function canRemove(
  actor: string,
  target: string,
  self: boolean,
): boolean {
  if (self) return isOrganizationRole(actor);
  if (actor === 'owner') return true;
  return actor === 'admin' && ADMIN_MANAGEABLE.some((role) => role === target);
}
