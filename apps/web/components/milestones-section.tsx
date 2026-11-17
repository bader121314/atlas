'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import type { Milestone } from '../lib/api';
import { Notice, value } from './form';

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Milestones with progress; managers can add, close and delete them. */
export function MilestonesSection({
  base,
  canManage,
}: {
  base: string;
  canManage: boolean;
}) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<Milestone[]>(`${base}/milestones`);
    setMilestones(result.data ?? []);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const due = value(form, 'milestoneDue');
    const result = await api(`${base}/milestones`, {
      method: 'POST',
      body: {
        title: value(form, 'milestoneTitle'),
        dueAt: due ? `${due}T12:00:00Z` : null,
      },
    });
    setError(
      result.ok
        ? ''
        : describeFailure(result.status, 'The milestone could not be created.'),
    );
    if (result.ok) form.reset();
    await load();
  }

  async function toggle(milestone: Milestone) {
    await api(`${base}/milestones/${milestone.id}`, {
      method: 'PATCH',
      body: { status: milestone.status === 'open' ? 'closed' : 'open' },
    });
    await load();
  }

  async function remove(milestone: Milestone) {
    if (!window.confirm(`Delete ${milestone.title}? Its tasks are kept.`))
      return;
    await api(`${base}/milestones/${milestone.id}`, { method: 'DELETE' });
    await load();
  }

  if (milestones.length === 0 && !canManage) return null;
  return (
    <section className="section" aria-labelledby="milestones-heading">
      <h2 id="milestones-heading">Milestones</h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {milestones.length === 0 ? (
        <p className="muted">No milestones yet.</p>
      ) : null}
      <ul className="rows">
        {milestones.map((m) => (
          <li key={m.id}>
            <span className="grow">
              <span className="title">{m.title}</span>
              {m.status === 'closed' ? (
                <span className="muted"> (closed)</span>
              ) : null}
              <br />
              <span className="muted">
                {m.doneCount} of {m.taskCount} tasks done
                {m.dueAt ? `, due ${day.format(new Date(m.dueAt))}` : ''}
              </span>
            </span>
            <progress
              max={Math.max(m.taskCount, 1)}
              value={m.doneCount}
              aria-label={`${m.title} progress`}
            />
            {canManage ? (
              <>
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() => void toggle(m)}
                >
                  {m.status === 'open' ? 'Close' : 'Reopen'}
                </button>
                <button
                  className="button danger small"
                  type="button"
                  onClick={() => void remove(m)}
                >
                  Delete
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form className="inline-form section" onSubmit={create}>
          <div className="field">
            <label htmlFor="milestoneTitle">New milestone</label>
            <input
              id="milestoneTitle"
              name="milestoneTitle"
              required
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor="milestoneDue">Due date</label>
            <input id="milestoneDue" name="milestoneDue" type="date" />
          </div>
          <button className="button secondary" type="submit">
            Add milestone
          </button>
        </form>
      ) : null}
    </section>
  );
}
