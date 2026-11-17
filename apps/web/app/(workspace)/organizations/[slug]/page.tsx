'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useShell } from '../../../../components/app-shell';
import { Field, Notice, value } from '../../../../components/form';
import { ApiTokensSection } from '../../../../components/api-tokens-section';
import { ProjectsSection } from '../../../../components/projects-section';
import { DomainsSection } from '../../../../components/domains-section';
import { ScimSection } from '../../../../components/scim-section';
import { SsoSection } from '../../../../components/sso-section';
import { WebhooksSection } from '../../../../components/webhooks-section';
import { api, describeFailure } from '../../../../lib/api';
import type { Organization } from '../../../../lib/api';
import { useT } from '../../../../lib/i18n';

type Role = Organization['role'];

interface Member {
  userId: string;
  displayName: string;
  email: string;
  role: Role;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  expiresAt: string;
}

// Mirrors the server rules (ADR-016) only to decide which controls to show.
// The API enforces them regardless.
function manageable(mine: Role, target: Role): boolean {
  return (
    mine === 'owner' ||
    (mine === 'admin' && (target === 'member' || target === 'guest'))
  );
}
function assignable(mine: Role): Role[] {
  return mine === 'owner'
    ? ['owner', 'admin', 'member', 'guest']
    : ['member', 'guest'];
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export default function OrganizationPage() {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user, refreshOrganizations } = useShell();
  const [organization, setOrganization] = useState<Organization>();
  const [missing, setMissing] = useState(false);
  const [members, setMembers] = useState<Member[]>();
  const [invitations, setInvitations] = useState<Invitation[]>();
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();

  const load = useCallback(async () => {
    const org = await api<Organization>(`/organizations/${slug}`);
    if (!org.data) {
      setMissing(true);
      return;
    }
    setOrganization(org.data);
    const role = org.data.role;
    const memberList = await api<{ members: Member[] }>(
      `/organizations/${slug}/members`,
    );
    setMembers(memberList.data?.members);
    if (role === 'owner' || role === 'admin') {
      const pending = await api<{ invitations: Invitation[] }>(
        `/organizations/${slug}/invitations`,
      );
      setInvitations(pending.data?.invitations);
    } else {
      setInvitations(undefined);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <>
        <h1>{t('Organization not found')}</h1>
        <p>
          {t(
            'It does not exist, or you are not a member. Ask an owner for an invitation.',
          )}
        </p>
        <p>
          <Link href="/organizations">{t('Back to your organizations')}</Link>
        </p>
      </>
    );
  }
  if (!organization) {
    return (
      <p className="muted" role="status">
        {t('Loading…')}
      </p>
    );
  }

  const mine = organization.role;
  const canInvite = mine === 'owner' || mine === 'admin';
  // The last owner cannot leave or step down (ADR-010), so do not offer it.
  const soleOwner =
    mine === 'owner' &&
    (members ?? []).filter((m) => m.role === 'owner').length <= 1;

  function report(
    ok: boolean,
    success: string,
    status: number,
    failure: string,
  ) {
    setMessage(
      ok
        ? { tone: 'info', text: success }
        : { tone: 'error', text: describeFailure(status, failure) },
    );
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api<Organization>(`/organizations/${slug}`, {
      method: 'PATCH',
      body: { name: value(event.currentTarget, 'orgName') },
    });
    report(
      result.ok,
      'Name saved.',
      result.status,
      'The name could not be saved.',
    );
    if (result.ok) {
      await load();
      await refreshOrganizations();
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = value(form, 'inviteEmail');
    const result = await api(`/organizations/${slug}/invitations`, {
      method: 'POST',
      body: { email, role: value(form, 'inviteRole') },
    });
    report(
      result.ok,
      `Invitation sent to ${email}.`,
      result.status,
      result.status === 409
        ? `${email} is already a member.`
        : 'The invitation could not be sent. Check the email address.',
    );
    if (result.ok) {
      form.reset();
      await load();
    }
  }

  async function revoke(invitation: Invitation) {
    const result = await api(
      `/organizations/${slug}/invitations/${invitation.id}`,
      {
        method: 'DELETE',
      },
    );
    report(
      result.ok,
      `Invitation for ${invitation.email} revoked.`,
      result.status,
      'The invitation could not be revoked.',
    );
    await load();
  }

  async function changeRole(member: Member, role: string) {
    const result = await api(
      `/organizations/${slug}/members/${member.userId}`,
      {
        method: 'PATCH',
        body: { role },
      },
    );
    report(
      result.ok,
      `${member.displayName} is now ${role}.`,
      result.status,
      result.status === 409
        ? 'An organization needs at least one owner. Make someone else owner first.'
        : 'The role could not be changed.',
    );
    await load();
  }

  async function remove(member: Member) {
    const self = member.userId === user.id;
    const question = self
      ? `Leave ${organization?.name}? You will need a new invitation to return.`
      : `Remove ${member.displayName} from ${organization?.name}?`;
    if (!window.confirm(question)) return;
    const result = await api(
      `/organizations/${slug}/members/${member.userId}`,
      {
        method: 'DELETE',
      },
    );
    if (result.ok && self) {
      await refreshOrganizations();
      router.replace('/organizations');
      return;
    }
    report(
      result.ok,
      `${member.displayName} was removed.`,
      result.status,
      result.status === 409
        ? 'An organization needs at least one owner. Make someone else owner first.'
        : 'The member could not be removed.',
    );
    await load();
  }

  return (
    <>
      <h1>{organization.name}</h1>
      <p className="muted">
        {t('Your role here is {role}', { role: t(mine) })}
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <ProjectsSection organization={organization} />
      {mine !== 'guest' ? (
        <p>
          <Link
            className="button secondary small"
            href={`/organizations/${slug}/workload`}
          >
            See the team&apos;s workload
          </Link>
          <Link
            className="button secondary small"
            href={`/organizations/${slug}/time`}
          >
            {t('Time report')}
          </Link>
        </p>
      ) : null}

      <section className="section" aria-labelledby="members-heading">
        <h2 id="members-heading">{t('Members')}</h2>
        {members ? (
          <ul className="rows">
            {members.map((member) => {
              const self = member.userId === user.id;
              const canManage = !self && manageable(mine, member.role);
              return (
                <li key={member.userId}>
                  <span className="grow">
                    <span className="title">
                      {member.displayName}
                      {self ? ' (you)' : ''}
                    </span>
                    <br />
                    <span className="muted">
                      {member.email}, joined{' '}
                      {dateFormat.format(new Date(member.joinedAt))}
                    </span>
                  </span>
                  {canManage || (self && mine === 'owner' && !soleOwner) ? (
                    <label>
                      <span className="muted">{t('Role')} </span>
                      <select
                        value={member.role}
                        onChange={(event) =>
                          void changeRole(member, event.target.value)
                        }
                      >
                        {assignable(mine).map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="role">{member.role}</span>
                  )}
                  {canManage || (self && !soleOwner) ? (
                    <button
                      className="button danger small"
                      type="button"
                      onClick={() => void remove(member)}
                    >
                      {self ? 'Leave' : 'Remove'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">{t('Guests cannot see the member list.')}</p>
        )}
      </section>

      {canInvite ? (
        <section className="section" aria-labelledby="invite-heading">
          <h2 id="invite-heading">{t('Invite someone')}</h2>
          <form className="inline-form" onSubmit={invite}>
            <Field
              label={t('Email')}
              name="inviteEmail"
              type="email"
              autoComplete="off"
            />
            <div className="field">
              <label htmlFor="inviteRole">{t('Role')}</label>
              <select id="inviteRole" name="inviteRole" defaultValue="member">
                {assignable(mine)
                  .filter((role) => role !== 'owner')
                  .map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
              </select>
            </div>
            <button className="button" type="submit">
              {t('Send invitation')}
            </button>
          </form>
          {invitations && invitations.length > 0 ? (
            <>
              <h3 className="section">{t('Waiting for a reply')}</h3>
              <ul className="rows">
                {invitations.map((invitation) => (
                  <li key={invitation.id}>
                    <span className="grow">
                      <span className="title">{invitation.email}</span>
                      <br />
                      <span className="muted">
                        Invited by {invitation.invitedBy}, expires{' '}
                        {dateFormat.format(new Date(invitation.expiresAt))}
                      </span>
                    </span>
                    <span className="role">{invitation.role}</span>
                    {manageable(mine, invitation.role) ? (
                      <button
                        className="button secondary small"
                        type="button"
                        onClick={() => void revoke(invitation)}
                      >
                        {t('Revoke')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {mine === 'owner' || mine === 'admin' ? (
        <section className="section" aria-labelledby="settings-heading">
          <h2 id="settings-heading">{t('Settings')}</h2>
          <form
            className="inline-form"
            onSubmit={rename}
            key={organization.name}
          >
            <Field
              label={t('Organization name')}
              name="orgName"
              defaultValue={organization.name}
            />
            <button className="button secondary" type="submit">
              {t('Save name')}
            </button>
          </form>
        </section>
      ) : null}
      {mine === 'owner' || mine === 'admin' ? (
        <>
          <WebhooksSection slug={slug} />
          <section className="section" aria-labelledby="audit-heading">
            <h2 id="audit-heading">{t('Audit and usage')}</h2>
            <p className="muted">
              {t(
                'Who changed members, projects, tokens and links, and how much the organization uses each month.',
              )}
            </p>
            <p>
              <Link
                className="button secondary small"
                href={`/organizations/${slug}/audit`}
              >
                {t('Open the audit log')}
              </Link>{' '}
              <Link
                className="button secondary small"
                href={`/organizations/${slug}/usage`}
              >
                {t('See usage')}
              </Link>
            </p>
          </section>
        </>
      ) : null}
      {mine === 'owner' ? (
        <>
          <DomainsSection slug={slug} />
          <SsoSection slug={slug} />
          <ScimSection slug={slug} />
        </>
      ) : null}
      {mine !== 'guest' ? <ApiTokensSection slug={slug} /> : null}
    </>
  );
}
