import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, DatabaseError } from 'pg';
import { parseEnvironment } from '../../packages/config/src';

// Database-level tenancy and integrity guarantees (ADR-010). These run against
// the migrated schema and must hold even if application code is wrong.

const db = new Client({
  connectionString: parseEnvironment(process.env).DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
const run = randomUUID().slice(0, 8);
const orgIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  // Test rows use per-run identifiers; remove them so local databases stay
  // tidy. Marking organizations deleted lifts the active-owner requirement.
  try {
    if (orgIds.length > 0) {
      await db.query(
        "UPDATE organizations SET status = 'deleted' WHERE id = ANY($1)",
        [orgIds],
      );
      await db.query(
        'DELETE FROM invitations WHERE organization_id = ANY($1)',
        [orgIds],
      );
      await db.query(
        'DELETE FROM organization_memberships WHERE organization_id = ANY($1)',
        [orgIds],
      );
      await db.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
    }
    if (userIds.length > 0) {
      await db.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    }
  } finally {
    await db.end();
  }
});

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    'INSERT INTO users (id, email_normalized, display_name) VALUES ($1, $2, $3)',
    [id, `${name}-${run}@example.test`, name],
  );
  userIds.push(id);
  return id;
}

async function createOrganization(ownerId: string): Promise<string> {
  const id = randomUUID();
  await db.query('BEGIN');
  try {
    await db.query(
      'INSERT INTO organizations (id, slug, name, created_by_user_id) VALUES ($1, $2, $3, $4)',
      [id, `org-${id.slice(0, 8)}`, 'Test organization', ownerId],
    );
    await db.query(
      "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [id, ownerId],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  orgIds.push(id);
  return id;
}

async function addMember(
  organizationId: string,
  userId: string,
  role: string,
): Promise<void> {
  await db.query(
    'INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)',
    [organizationId, userId, role],
  );
}

function invite(
  organizationId: string,
  inviterId: string,
  email: string,
  role = 'member',
): Promise<unknown> {
  return db.query(
    "INSERT INTO invitations (organization_id, email_normalized, invited_by_user_id, role, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')",
    [organizationId, email, inviterId, role, randomBytes(32)],
  );
}

async function expectDatabaseError(
  action: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  const error: unknown = await action.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DatabaseError);
  const dbError = error as DatabaseError;
  expect(dbError.code).toBe(code);
  if (constraint) expect(dbError.constraint).toBe(constraint);
}

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

describe('organization ownership', () => {
  it('requires an owner when an organization is created', async () => {
    const creator = await createUser('creator');
    const id = randomUUID();
    await expectDatabaseError(
      db.query(
        'INSERT INTO organizations (id, slug, name, created_by_user_id) VALUES ($1, $2, $3, $4)',
        [id, `org-${id.slice(0, 8)}`, 'No owner', creator],
      ),
      CHECK_VIOLATION,
      'organizations_active_owner_check',
    );
  });

  it('rejects removing, demoting or suspending the last owner', async () => {
    const owner = await createUser('last-owner');
    const org = await createOrganization(owner);
    const where = 'WHERE organization_id = $1 AND user_id = $2';
    for (const statement of [
      `DELETE FROM organization_memberships ${where}`,
      `UPDATE organization_memberships SET role = 'admin' ${where}`,
      `UPDATE organization_memberships SET state = 'suspended' ${where}`,
    ]) {
      await expectDatabaseError(
        db.query(statement, [org, owner]),
        CHECK_VIOLATION,
        'organizations_active_owner_check',
      );
    }
  });

  it('allows transferring ownership within one transaction', async () => {
    const owner = await createUser('outgoing-owner');
    const successor = await createUser('successor');
    const org = await createOrganization(owner);
    await db.query('BEGIN');
    await addMember(org, successor, 'owner');
    await db.query(
      "UPDATE organization_memberships SET role = 'admin' WHERE organization_id = $1 AND user_id = $2",
      [org, owner],
    );
    await db.query('COMMIT');
    const result = await db.query<{ user_id: string }>(
      "SELECT user_id FROM organization_memberships WHERE organization_id = $1 AND role = 'owner'",
      [org],
    );
    expect(result.rows.map((row) => row.user_id)).toEqual([successor]);
  });
});

describe('tenant isolation', () => {
  it('rejects an invitation from a member of another organization', async () => {
    const ownerA = await createUser('owner-a');
    const ownerB = await createUser('owner-b');
    const orgA = await createOrganization(ownerA);
    await createOrganization(ownerB);
    await expectDatabaseError(
      invite(orgA, ownerB, `target-${run}@example.test`),
      FOREIGN_KEY_VIOLATION,
      'invitations_inviter_membership_fkey',
    );
  });

  it('keeps organization_id immutable on tenant rows', async () => {
    const ownerA = await createUser('mover-a');
    const ownerB = await createUser('mover-b');
    const member = await createUser('mover');
    const orgA = await createOrganization(ownerA);
    const orgB = await createOrganization(ownerB);
    await addMember(orgA, member, 'member');
    await expectDatabaseError(
      db.query(
        'UPDATE organization_memberships SET organization_id = $1 WHERE organization_id = $2 AND user_id = $3',
        [orgB, orgA, member],
      ),
      CHECK_VIOLATION,
    );
  });

  it('allows one membership per user per organization', async () => {
    const owner = await createUser('dup-owner');
    const org = await createOrganization(owner);
    await expectDatabaseError(
      addMember(org, owner, 'member'),
      UNIQUE_VIOLATION,
      'organization_memberships_organization_id_user_id_key',
    );
  });
});

describe('invitations', () => {
  it('allows one outstanding invitation per email, reissuable after revoke', async () => {
    const owner = await createUser('inviter');
    const org = await createOrganization(owner);
    const email = `invitee-${run}@example.test`;
    await invite(org, owner, email);
    await expectDatabaseError(
      invite(org, owner, email),
      UNIQUE_VIOLATION,
      'invitations_outstanding_key',
    );
    await db.query(
      'UPDATE invitations SET revoked_at = now() WHERE organization_id = $1 AND email_normalized = $2',
      [org, email],
    );
    await invite(org, owner, email);
  });

  it('never grants ownership by invitation', async () => {
    const owner = await createUser('owner-inviter');
    const org = await createOrganization(owner);
    await expectDatabaseError(
      invite(org, owner, `would-be-owner-${run}@example.test`, 'owner'),
      CHECK_VIOLATION,
      'invitations_role_check',
    );
  });
});

describe('identity constraints', () => {
  it('stores only normalized, unique emails', async () => {
    const user = await createUser('unique');
    await expectDatabaseError(
      db.query(
        'INSERT INTO users (email_normalized, display_name) VALUES ($1, $2)',
        [`Mixed-${run}@Example.test`, 'Mixed'],
      ),
      CHECK_VIOLATION,
      'users_email_normalized_check',
    );
    await expectDatabaseError(
      db.query(
        'INSERT INTO users (email_normalized, display_name) VALUES ($1, $2)',
        [`unique-${run}@example.test`, 'Duplicate'],
      ),
      UNIQUE_VIOLATION,
      'users_email_normalized_key',
    );
    expect(user).toBeTruthy();
  });

  it('accepts only 32-byte session token digests', async () => {
    const user = await createUser('session');
    await expectDatabaseError(
      db.query(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [user, Buffer.from('raw-token')],
      ),
      CHECK_VIOLATION,
      'sessions_token_hash_check',
    );
    await db.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [user, randomBytes(32)],
    );
  });
});
