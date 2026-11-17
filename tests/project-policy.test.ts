import { describe, expect, it } from 'vitest';
import {
  PROJECT_ACTIONS,
  canProject,
  effectiveProjectRole,
} from '../apps/api/src/projects/policy';

describe('effective project role', () => {
  it.each([
    // [organization role, visibility, explicit, expected]
    ['owner', 'private', undefined, 'manager'],
    ['admin', 'private', 'viewer', 'manager'],
    ['member', 'organization', undefined, 'editor'],
    ['member', 'organization', 'viewer', 'viewer'],
    ['member', 'private', undefined, undefined],
    ['member', 'private', 'commenter', 'commenter'],
    ['guest', 'organization', undefined, undefined],
    ['guest', 'private', 'viewer', 'viewer'],
    ['guest', 'organization', 'manager', 'commenter'],
    ['guest', 'organization', 'editor', 'commenter'],
    ['superuser', 'organization', 'manager', undefined],
    ['member', 'organization', 'bogus', 'editor'],
  ] as const)(
    '%s on %s with %s is %s',
    (org, visibility, explicit, expected) => {
      expect(effectiveProjectRole(org, visibility, explicit)).toBe(expected);
    },
  );
});

describe('project permissions', () => {
  const EXPECTED: Record<string, string[]> = {
    manager: [...PROJECT_ACTIONS],
    editor: [
      'project.read',
      'task.read',
      'task.write',
      'task.comment',
      'task.export',
    ],
    commenter: ['project.read', 'task.read', 'task.comment'],
    viewer: ['project.read', 'task.read'],
  };
  it.each(Object.entries(EXPECTED))(
    '%s has exactly its grants',
    (role, grants) => {
      for (const action of PROJECT_ACTIONS) {
        expect(canProject(role as never, action)).toBe(grants.includes(action));
      }
    },
  );
});
