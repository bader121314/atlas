'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { PRIORITIES, api, describeFailure, priorityLabel } from '../lib/api';
import type { Label, Milestone, WorkflowState } from '../lib/api';
import { Notice } from './form';
import type { Sort } from './task-views';

export const LAYOUTS = ['board', 'list', 'table', 'calendar'] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface Filters {
  state?: string;
  assignee?: string;
  priority?: string;
  label?: string;
  milestone?: string;
}

export interface SavedView {
  id: string;
  name: string;
  shared: boolean;
  mine: boolean;
  owner: string;
  config: { layout: Layout; filters: Filters; sort: Sort };
}

/** Removes empty filter values so saved views and URLs stay minimal. */
function compact(filters: Filters): Filters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v),
  ) as Filters;
}

export function ViewToolbar({
  base,
  views,
  layout,
  filters,
  sort,
  states,
  labels,
  milestones,
  canManage,
  onApply,
  onFilters,
  onViewsChanged,
}: {
  base: string;
  views: SavedView[];
  layout: Layout;
  filters: Filters;
  sort: Sort;
  states: WorkflowState[];
  labels: Label[];
  milestones: Milestone[];
  canManage: boolean;
  onApply: (config: SavedView['config']) => void;
  onFilters: (filters: Filters) => void;
  onViewsChanged: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const set = (name: keyof Filters, value: string) =>
    onFilters(compact({ ...filters, [name]: value || undefined }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await api(`${base}/views`, {
      method: 'POST',
      body: {
        name: String(data.get('viewName') ?? ''),
        shared: data.get('viewShared') === 'on',
        config: { layout, filters: compact(filters), sort },
      },
    });
    setError(
      result.ok
        ? ''
        : result.status === 409
          ? 'You already have a view with that name.'
          : describeFailure(result.status, 'The view could not be saved.'),
    );
    if (result.ok) form.reset();
    await onViewsChanged();
  }

  async function remove(view: SavedView) {
    await api(`${base}/views/${view.id}`, { method: 'DELETE' });
    await onViewsChanged();
  }

  const select = (
    name: keyof Filters,
    label: string,
    options: { value: string; label: string }[],
    any: string,
  ) => (
    <div className="field">
      <label htmlFor={`filter-${name}`}>{label}</label>
      <select
        id={`filter-${name}`}
        value={filters[name] ?? ''}
        onChange={(event) => set(name, event.target.value)}
      >
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="section">
      {views.length > 0 ? (
        <ul className="chips" aria-label="Saved views">
          {views.map((view) => (
            <li key={view.id}>
              <button type="button" onClick={() => onApply(view.config)}>
                {view.name}
                {view.shared ? ' (shared)' : ''}
              </button>
              {view.mine || (view.shared && canManage) ? (
                <button
                  type="button"
                  aria-label={`Delete view ${view.name}`}
                  onClick={() => void remove(view)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="filters" role="group" aria-label="Filters">
        {select(
          'state',
          'Status',
          states.map((s) => ({ value: s.key, label: s.label })),
          'Any status',
        )}
        {select(
          'assignee',
          'Assignee',
          [
            { value: 'me', label: 'Me' },
            { value: 'none', label: 'Unassigned' },
          ],
          'Anyone',
        )}
        {select(
          'priority',
          'Priority',
          PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) })),
          'Any priority',
        )}
        {labels.length > 0
          ? select(
              'label',
              'Label',
              labels.map((l) => ({ value: l.id, label: l.name })),
              'Any label',
            )
          : null}
        {milestones.length > 0
          ? select(
              'milestone',
              'Milestone',
              [
                ...milestones.map((m) => ({ value: m.id, label: m.title })),
                { value: 'none', label: 'No milestone' },
              ],
              'Any milestone',
            )
          : null}
        {Object.values(filters).some(Boolean) ? (
          <button
            className="button secondary small"
            type="button"
            onClick={() => onFilters({})}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <form className="inline-form" onSubmit={save}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="field">
          <label htmlFor="viewName">Save this view as</label>
          <input id="viewName" name="viewName" required maxLength={60} />
        </div>
        <label className="checks inline">
          <span>
            <input type="checkbox" name="viewShared" /> Share with the project
          </span>
        </label>
        <button className="button secondary" type="submit">
          Save view
        </button>
      </form>
    </div>
  );
}
