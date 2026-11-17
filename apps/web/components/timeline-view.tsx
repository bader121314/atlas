'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Task } from '../lib/api';
import { layoutTimeline, utcDay, weekStart } from '../lib/timeline';
import { useT } from '../lib/i18n';

const DAY = 86_400_000;
const WEEKS = 8;

const short = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function span(task: Task): string {
  const start = task.startAt ? short.format(new Date(task.startAt)) : null;
  const due = task.dueAt ? short.format(new Date(task.dueAt)) : null;
  if (start && due) return start === due ? `${due}` : `${start} to ${due}`;
  if (due) return `due ${due}`;
  return `starts ${start ?? ''}`;
}

/**
 * Tasks on a week grid from start to due date (ADR-052). The dates are also
 * written next to each task, so the bars are a visual aid, not the only
 * source of the schedule.
 */
export function TimelineView({
  tasks,
  href,
}: {
  tasks: Task[];
  href: (task: Task) => string;
}) {
  const t = useT();
  const now = Date.now();
  const [from, setFrom] = useState(() => weekStart(now) - 7 * DAY);
  const days = WEEKS * 7;
  const { bars, outside, undated } = layoutTimeline(tasks, from, days, now);
  const weeks = Array.from({ length: WEEKS }, (_, i) => from + i * 7 * DAY);
  const today = utcDay(now);
  const todayLeft =
    today >= from && today < from + days * DAY
      ? ((today - from) / (days * DAY)) * 100
      : null;
  const range = `${short.format(new Date(from))} to ${short.format(new Date(from + (days - 1) * DAY))}`;

  return (
    <section aria-label={t('Timeline')}>
      <div className="calendar-head">
        <button
          className="button secondary small"
          type="button"
          onClick={() => setFrom(from - 4 * 7 * DAY)}
        >
          {t('Earlier')}
        </button>
        <h2>{range}</h2>
        <span className="timeline-nav">
          <button
            className="button secondary small"
            type="button"
            onClick={() => setFrom(weekStart(now) - 7 * DAY)}
          >
            {t('This week')}
          </button>
          <button
            className="button secondary small"
            type="button"
            onClick={() => setFrom(from + 4 * 7 * DAY)}
          >
            {t('Later')}
          </button>
        </span>
      </div>
      {bars.length === 0 ? (
        <p>
          {t(
            'No tasks are scheduled in these weeks. Give tasks a start or due date to place them here.',
          )}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="timeline">
            <caption className="visually-hidden">
              Tasks scheduled from {range}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('Task')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('Schedule')}</span>
                  <div className="timeline-track" aria-hidden="true">
                    {weeks.map((w, i) => (
                      <span
                        key={w}
                        className="timeline-week"
                        style={{ insetInlineStart: `${(i / WEEKS) * 100}%` }}
                      >
                        {short.format(new Date(w))}
                      </span>
                    ))}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {bars.map((bar) => (
                <tr key={bar.task.id}>
                  <th scope="row">
                    <Link href={href(bar.task)}>
                      {bar.task.key} {bar.task.title}
                    </Link>
                    <br />
                    <span className="muted">
                      {span(bar.task)}
                      {bar.overdue ? ', overdue' : ''}
                      {bar.task.state.category === 'done' ? ', done' : ''}
                    </span>
                  </th>
                  <td>
                    <div className="timeline-track" aria-hidden="true">
                      {weeks.slice(1).map((w, i) => (
                        <span
                          key={w}
                          className="timeline-gridline"
                          style={{
                            insetInlineStart: `${((i + 1) / WEEKS) * 100}%`,
                          }}
                        />
                      ))}
                      {todayLeft === null ? null : (
                        <span
                          className="timeline-today"
                          style={{ insetInlineStart: `${todayLeft}%` }}
                        />
                      )}
                      <span
                        className={[
                          'timeline-bar',
                          bar.task.state.category,
                          bar.overdue ? 'overdue' : '',
                          bar.dueOnly ? 'due-only' : '',
                          bar.clippedStart ? 'clipped-start' : '',
                          bar.clippedEnd ? 'clipped-end' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{
                          insetInlineStart: `${bar.left}%`,
                          width: `${bar.width}%`,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {outside > 0 || undated > 0 ? (
        <p className="muted">
          {[
            outside > 0
              ? `${outside} scheduled ${outside === 1 ? 'task is' : 'tasks are'} outside these weeks`
              : '',
            undated > 0
              ? `${undated} ${undated === 1 ? 'task has' : 'tasks have'} no dates`
              : '',
          ]
            .filter(Boolean)
            .join('; ')}
          .
        </p>
      ) : null}
    </section>
  );
}
