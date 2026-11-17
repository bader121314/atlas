'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useT } from '../../../../../lib/i18n';

interface Usage {
  members: number;
  guests: number;
  projects: { active: number; archived: number };
  tasks: number;
  storageBytes: number;
  months: {
    period: string;
    apiRequests: number;
    scimRequests: number;
    webhookDeliveries: number;
    notificationEmails: number;
  }[];
}

const number = new Intl.NumberFormat();
const monthName = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function bytes(value: number): string {
  if (value < 1024 * 1024)
    return `${number.format(Math.round(value / 1024))} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

/** Organization size and metered usage for owners and admins (ADR-056). */
export default function UsagePage() {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const [usage, setUsage] = useState<Usage>();
  const [status, setStatus] = useState<number>();

  useEffect(() => {
    void api<Usage>(`/organizations/${slug}/usage`).then((r) => {
      setStatus(r.status);
      setUsage(r.data);
    });
  }, [slug]);

  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>{t('Organization')}</Link>{' '}
        {t('/ Usage')}
      </p>
      <h1>{t('Usage')}</h1>
      {status === 403 ? (
        <p>{t('Only owners and admins can see usage.')}</p>
      ) : !usage ? (
        <p className="muted" role="status">
          {t('Loading…')}
        </p>
      ) : (
        <>
          <dl className="usage-facts">
            <div>
              <dt>{t('Members')}</dt>
              <dd>{number.format(usage.members)}</dd>
            </div>
            <div>
              <dt>{t('Guests')}</dt>
              <dd>{number.format(usage.guests)}</dd>
            </div>
            <div>
              <dt>{t('Projects')}</dt>
              <dd>
                {number.format(usage.projects.active)}
                {usage.projects.archived > 0
                  ? ` (and ${number.format(usage.projects.archived)} archived)`
                  : ''}
              </dd>
            </div>
            <div>
              <dt>{t('Tasks')}</dt>
              <dd>{number.format(usage.tasks)}</dd>
            </div>
            <div>
              <dt>{t('File storage')}</dt>
              <dd>{bytes(usage.storageBytes)}</dd>
            </div>
          </dl>
          <section className="section" aria-labelledby="metered-heading">
            <h2 id="metered-heading">{t('By month')}</h2>
            <p className="muted">
              {t(
                'Requests from API tokens and your identity provider, webhook deliveries and notification emails, counted in UTC months.',
              )}
            </p>
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t('Usage by month')}
            >
              <table className="tasks-table">
                <caption className="visually-hidden">
                  {t('Metered usage for the last six months')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Month')}</th>
                    <th scope="col">{t('API requests')}</th>
                    <th scope="col">{t('Provisioning requests')}</th>
                    <th scope="col">{t('Webhook deliveries')}</th>
                    <th scope="col">{t('Notification emails')}</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.months.map((m) => (
                    <tr key={m.period}>
                      <th scope="row">
                        {monthName.format(new Date(`${m.period}-01T00:00:00Z`))}
                      </th>
                      <td>{number.format(m.apiRequests)}</td>
                      <td>{number.format(m.scimRequests)}</td>
                      <td>{number.format(m.webhookDeliveries)}</td>
                      <td>{number.format(m.notificationEmails)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
