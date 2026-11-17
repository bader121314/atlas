'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import type { Label } from '../lib/api';
import { Notice } from './form';

type Role = 'manager' | 'editor' | 'commenter' | 'viewer';

interface ProjectMember {
  userId: string;
  displayName: string;
  role: Role;
  labelIds: string[] | null;
}

interface OrganizationMember {
  userId: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
}

const ROLES: [Role, string][] = [
  ['manager', 'Manager'],
  ['editor', 'Editor'],
  ['commenter', 'Commenter'],
  ['viewer', 'Viewer'],
];

/**
 * Who is explicitly in a project, their role, and for guests the labels
 * that limit which tasks they see (ADR-018, ADR-059). Managers only.
 */
export function ProjectMembersSection({
  base,
  slug,
}: {
  base: string;
  slug: string;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [people, setPeople] = useState<OrganizationMember[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();

  const load = useCallback(async () => {
    const [m, p, l] = await Promise.all([
      api<{ members: ProjectMember[] }>(`${base}/members`),
      api<{ members: OrganizationMember[] }>(`/organizations/${slug}/members`),
      api<Label[]>(`/organizations/${slug}/labels`),
    ]);
    setMembers(m.data?.members ?? []);
    setPeople(p.data?.members ?? []);
    setLabels(l.data ?? []);
  }, [base, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const guestIds = new Set(
    people.filter((p) => p.role === 'guest').map((p) => p.userId),
  );

  async function put(
    userId: string,
    body: Record<string, unknown>,
    done: string,
  ) {
    const result = await api(`${base}/members/${userId}`, {
      method: 'PUT',
      body,
    });
    setMessage(
      result.ok
        ? { tone: 'info', text: done }
        : {
            tone: 'error',
            text: describeFailure(
              result.status,
              'That change is not allowed. Guests can be at most commenters.',
            ),
          },
    );
    await load();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const userId = String(values.get('person') ?? '');
    if (!userId) return;
    await put(
      userId,
      { role: String(values.get('role')) },
      'Added to the project.',
    );
  }

  async function remove(member: ProjectMember) {
    if (!window.confirm(`Remove ${member.displayName} from this project?`))
      return;
    const result = await api(`${base}/members/${member.userId}`, {
      method: 'DELETE',
    });
    setMessage(
      result.ok
        ? { tone: 'info', text: `${member.displayName} was removed.` }
        : {
            tone: 'error',
            text: describeFailure(result.status, 'Not removed.'),
          },
    );
    await load();
  }

  const candidates = people.filter(
    (p) =>
      p.role !== 'owner' &&
      p.role !== 'admin' &&
      !members.some((m) => m.userId === p.userId),
  );

  return (
    <section className="section" aria-labelledby="project-members-heading">
      <h2 id="project-members-heading">Project members</h2>
      <p className="muted">
        Owners and admins manage every project. Add people here to give them a
        role in this project; guests can also be limited to tasks with chosen
        labels.
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ul className="rows">
        {members.map((member) => {
          const guest = guestIds.has(member.userId);
          return (
            <li key={member.userId}>
              <span className="grow">
                <span className="title">{member.displayName}</span>
                {guest ? <span className="muted"> (guest)</span> : null}
                {guest ? (
                  <fieldset className="checks plain">
                    <legend>Sees tasks labelled</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={member.labelIds === null}
                        onChange={(event) =>
                          void put(
                            member.userId,
                            {
                              role: member.role,
                              labelIds: event.target.checked ? null : [],
                            },
                            event.target.checked
                              ? `${member.displayName} sees every task.`
                              : `${member.displayName} sees only labelled tasks.`,
                          )
                        }
                      />
                      Any label (every task)
                    </label>
                    {member.labelIds === null
                      ? null
                      : labels.map((label) => (
                          <label key={label.id}>
                            <input
                              type="checkbox"
                              checked={
                                member.labelIds?.includes(label.id) ?? false
                              }
                              onChange={(event) =>
                                void put(
                                  member.userId,
                                  {
                                    role: member.role,
                                    labelIds: event.target.checked
                                      ? [...(member.labelIds ?? []), label.id]
                                      : (member.labelIds ?? []).filter(
                                          (id) => id !== label.id,
                                        ),
                                  },
                                  'Visible labels saved.',
                                )
                              }
                            />
                            {label.name}
                          </label>
                        ))}
                  </fieldset>
                ) : null}
              </span>
              <label
                className="visually-hidden"
                htmlFor={`role-${member.userId}`}
              >
                Role for {member.displayName}
              </label>
              <select
                id={`role-${member.userId}`}
                value={member.role}
                onChange={(event) =>
                  void put(
                    member.userId,
                    { role: event.target.value },
                    'Role saved.',
                  )
                }
              >
                {ROLES.filter(
                  ([role]) =>
                    !guest || role === 'commenter' || role === 'viewer',
                ).map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                className="button danger small"
                type="button"
                onClick={() => void remove(member)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {candidates.length > 0 ? (
        <form className="inline-form section" onSubmit={(e) => void add(e)}>
          <div className="field">
            <label htmlFor="projectMemberPerson">Person</label>
            <select id="projectMemberPerson" name="person">
              {candidates.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.displayName}
                  {p.role === 'guest' ? ' (guest)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="projectMemberRole">Role</label>
            <select id="projectMemberRole" name="role" defaultValue="commenter">
              {ROLES.map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button className="button secondary" type="submit">
            Add to project
          </button>
        </form>
      ) : null}
    </section>
  );
}
