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
] as const;
export type OrganizationAction = (typeof ORGANIZATION_ACTIONS)[number];

const GRANTS: Record<OrganizationAction, readonly OrganizationRole[]> = {
  'organization.read': ['owner', 'admin', 'member', 'guest'],
  'organization.update': ['owner', 'admin'],
  'members.read': ['owner', 'admin', 'member'],
};

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function can(role: string, action: OrganizationAction): boolean {
  return isOrganizationRole(role) && GRANTS[action].includes(role);
}
