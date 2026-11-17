import { describe, expect, it } from 'vitest';
import {
  ORGANIZATION_ACTIONS,
  ORGANIZATION_ROLES,
  can,
  canChangeRole,
  canInviteAs,
  canRemove,
} from '../apps/api/src/organizations/policy';

// Machine-verifiable permission matrix (docs/05). Changing a grant must
// change this table in the same review.
const EXPECTED: Record<string, Record<string, boolean>> = {
  owner: {
    'organization.read': true,
    'organization.update': true,
    'members.read': true,
    'members.invite': true,
    'members.manage': true,
    'projects.create': true,
    'labels.manage': true,
    'labels.delete': true,
    'webhooks.manage': true,
    'audit.read': true,
    'scim.manage': true,
    'usage.read': true,
  },
  admin: {
    'organization.read': true,
    'organization.update': true,
    'members.read': true,
    'members.invite': true,
    'members.manage': true,
    'projects.create': true,
    'labels.manage': true,
    'labels.delete': true,
    'webhooks.manage': true,
    'audit.read': true,
    'scim.manage': false,
    'usage.read': true,
  },
  member: {
    'organization.read': true,
    'organization.update': false,
    'members.read': true,
    'members.invite': false,
    'members.manage': false,
    'projects.create': true,
    'labels.manage': true,
    'labels.delete': false,
    'webhooks.manage': false,
    'audit.read': false,
    'scim.manage': false,
    'usage.read': false,
  },
  guest: {
    'organization.read': true,
    'organization.update': false,
    'members.read': false,
    'members.invite': false,
    'members.manage': false,
    'projects.create': false,
    'labels.manage': false,
    'labels.delete': false,
    'webhooks.manage': false,
    'audit.read': false,
    'scim.manage': false,
    'usage.read': false,
  },
};

describe('organization policy', () => {
  it.each(
    ORGANIZATION_ROLES.flatMap((role) =>
      ORGANIZATION_ACTIONS.map((action) => [role, action] as const),
    ),
  )('%s may %s only as the matrix says', (role, action) => {
    expect(can(role, action)).toBe(EXPECTED[role]?.[action]);
  });

  it('denies unknown roles everything', () => {
    for (const action of ORGANIZATION_ACTIONS) {
      expect(can('superuser', action)).toBe(false);
      expect(can('', action)).toBe(false);
    }
  });
});

describe('role assignment rules', () => {
  it('lets owners invite any non-owner role and admins only member or guest', () => {
    expect(
      ['admin', 'member', 'guest'].map((r) => canInviteAs('owner', r)),
    ).toEqual([true, true, true]);
    expect(
      ['admin', 'member', 'guest'].map((r) => canInviteAs('admin', r)),
    ).toEqual([false, true, true]);
    for (const actor of ['owner', 'admin', 'member', 'guest']) {
      expect(canInviteAs(actor, 'owner')).toBe(false);
    }
    expect(canInviteAs('member', 'guest')).toBe(false);
  });

  it('never lets admins create, change or remove privileged roles', () => {
    expect(canChangeRole('admin', 'member', 'guest')).toBe(true);
    expect(canChangeRole('admin', 'member', 'admin')).toBe(false);
    expect(canChangeRole('admin', 'admin', 'member')).toBe(false);
    expect(canChangeRole('admin', 'owner', 'member')).toBe(false);
    expect(canChangeRole('owner', 'member', 'owner')).toBe(true);
    expect(canChangeRole('member', 'guest', 'member')).toBe(false);
    expect(canChangeRole('owner', 'member', 'superuser')).toBe(false);

    expect(canRemove('admin', 'guest', false)).toBe(true);
    expect(canRemove('admin', 'admin', false)).toBe(false);
    expect(canRemove('owner', 'admin', false)).toBe(true);
    expect(canRemove('member', 'guest', false)).toBe(false);
    expect(canRemove('guest', 'guest', true)).toBe(true);
  });
});
