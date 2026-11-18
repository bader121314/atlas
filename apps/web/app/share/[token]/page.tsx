'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { n, useT } from '../../../lib/i18n';

interface Shared {
  project: { key: string; name: string };
  tasks: {
    number: number;
    title: string;
    state: string;
    category: 'todo' | 'in_progress' | 'done';
    priority: string;
    dueOn: string | null;
  }[];
  truncated: boolean;
  expiresAt: string;
}

const date = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

const PRIORITY: Record<string, string> = {
  none: '',
  low: n('Low'),
  medium: n('Medium'),
  high: n('High'),
  urgent: n('Urgent'),
};

/** Read-only view of a project's tasks for anyone with the link (ADR-050). */
export default function SharedProjectPage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Shared>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api<Shared>(`/public/shares/${encodeURIComponent(token)}`).then(
      (r) => {
        setData(r.data);
        setMissing(!r.ok);
      },
    );
  }, [token]);

  if (missing)
    return (
      <>
        <h1>{t('This link does not work')}</h1>
        <p>
          {t(
            'It may have expired or been revoked. Ask the person who shared it for a new one.',
          )}
        </p>
      </>
    );
  if (!data)
    return (
      <p className="muted" role="status">
        {t('Loading…')}
      </p>
    );

  const states: string[] = [];
  for (const task of data.tasks)
    if (!states.includes(task.state)) states.push(task.state);

  return (
    <>
      <p className="muted">{t('Shared from Atlas, read only')}</p>
      <h1>
        {data.project.key} {data.project.name}
      </h1>
      <p className="muted">
        {data.tasks.length} {data.tasks.length === 1 ? 'task' : 'tasks'}
        {data.truncated ? ' (the first 500)' : ''}. This link works until{' '}
        {date.format(new Date(data.expiresAt))}.
      </p>
      {data.tasks.length === 0 ? <p>{t('No tasks yet.')}</p> : null}
      {states.map((state) => {
        const tasks = data.tasks.filter((t) => t.state === state);
        const id = `state-${states.indexOf(state)}`;
        return (
          <section key={state} className="section" aria-labelledby={id}>
            <h2 id={id}>
              {state} <span className="muted">({tasks.length})</span>
            </h2>
            <ul className="rows">
              {tasks.map((task) => (
                <li key={task.number}>
                  <span className="grow">
                    <span className="title">
                      {data.project.key}-{task.number} {task.title}
                    </span>
                    {PRIORITY[task.priority] || task.dueOn ? (
                      <>
                        <br />
                        <span className="muted">
                          {[
                            PRIORITY[task.priority]
                              ? t('{priority} priority', {
                                  priority: t(PRIORITY[task.priority] ?? ''),
                                })
                              : '',
                            task.dueOn
                              ? t('due {date}', {
                                  date: date.format(
                                    new Date(`${task.dueOn}T00:00:00Z`),
                                  ),
                                })
                              : '',
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
