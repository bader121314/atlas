'use client';

import Link from 'next/link';
import { useState } from 'react';
import { priorityLabel } from '../lib/api';
import type { CustomField, Task } from '../lib/api';
import { formatFieldValue } from './custom-fields';

export type SortField =
  'number' | 'title' | 'priority' | 'due' | 'state' | 'assignee';
export interface Sort {
  field: SortField;
  direction: 'asc' | 'desc';
}

const PRIORITY_RANK: Record<Task['priority'], number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

/** Sorts a copy; tasks without a value (no due date, unassigned) go last. */
export function sortTasks(tasks: Task[], sort: Sort): Task[] {
  const value = (task: Task): string | number | null => {
    switch (sort.field) {
      case 'title':
        return task.title.toLowerCase();
      case 'priority':
        return PRIORITY_RANK[task.priority];
      case 'due':
        return task.dueAt;
      case 'state':
        return task.state.position;
      case 'assignee':
        return task.assignee?.displayName.toLowerCase() ?? null;
      default:
        return task.number;
    }
  };
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === y) return a.number - b.number;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * factor;
  });
}

function ariaSort(active: boolean, sort: Sort) {
  if (!active) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

const COLUMNS: { field: SortField; label: string }[] = [
  { field: 'number', label: 'Key' },
  { field: 'title', label: 'Title' },
  { field: 'state', label: 'Status' },
  { field: 'priority', label: 'Priority' },
  { field: 'assignee', label: 'Assignee' },
  { field: 'due', label: 'Due' },
];

const day = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

export function TableView({
  tasks,
  fields = [],
  sort,
  onSort,
  href,
}: {
  tasks: Task[];
  fields?: CustomField[];
  sort: Sort;
  onSort: (sort: Sort) => void;
  href: (task: Task) => string;
}) {
  return (
    <div className="table-wrap">
      <table className="tasks-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = sort.field === column.field;
              return (
                <th
                  key={column.field}
                  scope="col"
                  aria-sort={ariaSort(active, sort)}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onSort({
                        field: column.field,
                        direction:
                          active && sort.direction === 'asc' ? 'desc' : 'asc',
                      })
                    }
                  >
                    {column.label}
                    {active ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              );
            })}
            {fields.map((field) => (
              <th key={field.id} scope="col">
                {field.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortTasks(tasks, sort).map((task) => (
            <tr key={task.id}>
              <td className="muted">{task.key}</td>
              <td>
                <Link href={href(task)}>{task.title}</Link>
              </td>
              <td>{task.state.label}</td>
              <td className={`priority-${task.priority}`}>
                {priorityLabel(task.priority)}
              </td>
              <td>
                {task.assignees.length > 0 ? (
                  task.assignees.map((a) => a.displayName).join(', ')
                ) : (
                  <span className="muted">Unassigned</span>
                )}
              </td>
              <td>
                {task.dueAt ? (
                  day.format(new Date(task.dueAt))
                ) : (
                  <span className="muted">None</span>
                )}
              </td>
              {fields.map((field) => (
                <td key={field.id}>
                  {formatFieldValue(field, task.fields[field.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function undatedText(count: number): string {
  return count === 1
    ? '1 task has no due date and is not shown.'
    : `${count} tasks have no due date and are not shown.`;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthName = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Month grid by due date (UTC days). Tasks without a due date are counted below. */
export function CalendarView({
  tasks,
  href,
}: {
  tasks: Task[];
  href: (task: Task) => string;
}) {
  const today = new Date();
  const [month, setMonth] = useState(() =>
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const first = new Date(month);
  const year = first.getUTCFullYear();
  const index = first.getUTCMonth();
  const days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const byDay = new Map<number, Task[]>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const due = new Date(task.dueAt);
    if (due.getUTCFullYear() !== year || due.getUTCMonth() !== index) continue;
    const list = byDay.get(due.getUTCDate()) ?? [];
    list.push(task);
    byDay.set(due.getUTCDate(), list);
  }
  const undated = tasks.filter((task) => !task.dueAt).length;
  const cells = Array.from(
    { length: Math.ceil((offset + days) / 7) * 7 },
    (_, i) => (i < offset || i >= offset + days ? null : i - offset + 1),
  );
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) =>
    cells.slice(w * 7, w * 7 + 7),
  );

  return (
    <section aria-label="Calendar">
      <div className="calendar-head">
        <button
          className="button secondary small"
          type="button"
          onClick={() => setMonth(Date.UTC(year, index - 1, 1))}
        >
          Previous month
        </button>
        <h2>{monthName.format(first)}</h2>
        <button
          className="button secondary small"
          type="button"
          onClick={() => setMonth(Date.UTC(year, index + 1, 1))}
        >
          Next month
        </button>
      </div>
      <div
        className="calendar"
        role="table"
        aria-label={monthName.format(first)}
      >
        <div className="calendar-row" role="row">
          {WEEKDAYS.map((d) => (
            <div key={d} className="calendar-weekday" role="columnheader">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={w} className="calendar-row" role="row">
            {week.map((date, i) => (
              <div
                key={i}
                className={date ? 'calendar-day' : 'calendar-day empty'}
                role="cell"
              >
                {date ? <span className="calendar-date">{date}</span> : null}
                {(date ? (byDay.get(date) ?? []) : []).map((task) => (
                  <Link
                    key={task.id}
                    className="calendar-task"
                    href={href(task)}
                  >
                    {task.key} {task.title}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {undated > 0 ? <p className="muted">{undatedText(undated)}</p> : null}
    </section>
  );
}
