import { describe, expect, it } from 'vitest';
import {
  ORGANIZATION_ACTIONS,
  ORGANIZATION_ROLES,
  can,
} from '../apps/api/src/organizations/policy';

// Machine-verifiable permission matrix (docs/05). Changing a grant must
// change this table in the same review.
const EXPECTED: Record<string, Record<string, boolean>> = {
  owner: {
    'organization.read': true,
    'organization.update': true,
    'members.read': true,
  },
  admin: {
    'organization.read': true,
    'organization.update': true,
    'members.read': true,
  },
  member: {
    'organization.read': true,
    'organization.update': false,
    'members.read': true,
  },
  guest: {
    'organization.read': true,
    'organization.update': false,
    'members.read': false,
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
