import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { Client } from 'pg';
import { parseEnvironment } from '../../../packages/config/src';
import { startAuthApp } from './auth-app';

export interface Account {
  email: string;
  cookie: string;
  id: string;
}

type Api = Awaited<ReturnType<typeof startAuthApp>>;

/**
 * Accounts, organizations and memberships built through the real API, with
 * cleanup of every organization this fixture created.
 */
export async function startFixtures() {
  const api: Api = await startAuthApp();
  const db = new Client({
    connectionString: parseEnvironment(process.env).DATABASE_URL,
  });
  await db.connect();
  const run = randomUUID().slice(0, 8);
  const slugs: string[] = [];
  let counter = 0;

  async function account(label: string): Promise<Account> {
    counter += 1;
    const email = await api.verifiedAccount(`${label}${counter}`);
    const cookie = await api.login(email);
    const user = await db.query<{ id: string }>(
      'SELECT id FROM users WHERE email_normalized = $1',
      [email],
    );
    return { email, cookie, id: user.rows[0]?.id ?? '' };
  }

  async function organization(owner: Account): Promise<string> {
    counter += 1;
    const slug = `fx-${run}-${counter}`;
    slugs.push(slug);
    const response = await api.api('POST', '/organizations', {
      cookie: owner.cookie,
      body: { name: `Org ${counter}`, slug },
    });
    expect(response.status).toBe(201);
    return slug;
  }

  async function join(slug: string, owner: Account, role: string) {
    const who = await account(role);
    await api.api('POST', `/organizations/${slug}/invitations`, {
      cookie: owner.cookie,
      body: { email: who.email, role },
    });
    const accepted = await api.api('POST', '/invitations/accept', {
      cookie: who.cookie,
      body: { token: api.mailer.token(who.email, '/invitations/accept') },
    });
    expect(accepted.status).toBe(201);
    return who;
  }

  async function call(
    who: Account,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const response = await api.api(method, path, {
      cookie: who.cookie,
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    return {
      status: response.status,
      json: text ? JSON.parse(text) : undefined,
    };
  }

  async function close(): Promise<void> {
    try {
      const orgs = '(SELECT id FROM organizations WHERE slug = ANY($1))';
      await db.query(
        "UPDATE organizations SET status = 'deleted' WHERE slug = ANY($1)",
        [slugs],
      );
      for (const table of [
        'outbox_events',
        'activity_events',
        'task_comments',
        'task_labels',
        'labels',
        'tasks',
        'workflow_states',
        'project_memberships',
        'projects',
        'invitations',
        'organization_memberships',
      ]) {
        await db.query(
          `DELETE FROM ${table} WHERE organization_id IN ${orgs}`,
          [slugs],
        );
      }
      await db.query('DELETE FROM organizations WHERE slug = ANY($1)', [slugs]);
    } finally {
      await db.end();
      await api.close();
    }
  }

  return { api, db, account, organization, join, call, close };
}
