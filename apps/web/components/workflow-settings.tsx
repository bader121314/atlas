'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import type { WorkflowState } from '../lib/api';
import { Notice, value } from './form';
import { n, useT } from '../lib/i18n';

const CATEGORIES: { value: WorkflowState['category']; label: string }[] = [
  { value: 'todo', label: n('Not started') },
  { value: 'in_progress', label: n('Started') },
  { value: 'done', label: n('Finished') },
];

/** Project managers customize the columns of the board. */
export function WorkflowSettings({
  base,
  states,
  onChange,
}: {
  base: string;
  states: WorkflowState[];
  onChange: () => Promise<void>;
}) {
  const t = useT();
  const [error, setError] = useState('');

  async function run(
    request: Promise<{ ok: boolean; status: number }>,
    failure: string,
  ) {
    const result = await request;
    setError(result.ok ? '' : describeFailure(result.status, failure));
    await onChange();
  }

  function move(index: number, offset: number) {
    const order = states.map((s) => s.id);
    const [item] = order.splice(index, 1);
    if (!item) return;
    order.splice(index + offset, 0, item);
    void run(
      api(`${base}/states/order`, { method: 'PUT', body: { stateIds: order } }),
      t('The order could not be saved.'),
    );
  }

  function remove(state: WorkflowState, moveTo: string) {
    const query = moveTo ? `?moveTo=${moveTo}` : '';
    void run(
      api(`${base}/states/${state.id}${query}`, { method: 'DELETE' }),
      'Choose where its tasks should go first. A project needs at least one status.',
    );
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await run(
      api(`${base}/states`, {
        method: 'POST',
        body: {
          label: value(form, 'stateLabel'),
          category: value(form, 'stateCategory'),
        },
      }),
      t('The status could not be added.'),
    );
    form.reset();
  }

  return (
    <section className="section" aria-labelledby="workflow-heading">
      <h2 id="workflow-heading">{t('Workflow')}</h2>
      <p className="muted">
        {t(
          'Each status is a column on the board. Tasks in a finished status count as completed.',
        )}
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ul className="rows">
        {states.map((state, index) => (
          <WorkflowRow
            key={`${state.id}-${state.label}-${state.category}`}
            state={state}
            others={states.filter((s) => s.id !== state.id)}
            first={index === 0}
            last={index === states.length - 1}
            onRename={(label) =>
              void run(
                api(`${base}/states/${state.id}`, {
                  method: 'PATCH',
                  body: { label },
                }),
                t('The name could not be saved.'),
              )
            }
            onCategory={(category) =>
              void run(
                api(`${base}/states/${state.id}`, {
                  method: 'PATCH',
                  body: { category },
                }),
                t('The type could not be saved.'),
              )
            }
            onMove={(offset) => move(index, offset)}
            onRemove={(moveTo) => remove(state, moveTo)}
          />
        ))}
      </ul>
      <form className="inline-form section" onSubmit={add}>
        <div className="field">
          <label htmlFor="stateLabel">{t('New status')}</label>
          <input id="stateLabel" name="stateLabel" required maxLength={50} />
        </div>
        <div className="field">
          <label htmlFor="stateCategory">{t('Type')}</label>
          <select
            id="stateCategory"
            name="stateCategory"
            defaultValue="in_progress"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {t(c.label)}
              </option>
            ))}
          </select>
        </div>
        <button className="button secondary" type="submit">
          {t('Add status')}
        </button>
      </form>
    </section>
  );
}

function WorkflowRow({
  state,
  others,
  first,
  last,
  onRename,
  onCategory,
  onMove,
  onRemove,
}: {
  state: WorkflowState;
  others: WorkflowState[];
  first: boolean;
  last: boolean;
  onRename: (label: string) => void;
  onCategory: (category: string) => void;
  onMove: (offset: number) => void;
  onRemove: (moveTo: string) => void;
}) {
  const t = useT();
  const [moveTo, setMoveTo] = useState('');
  return (
    <li>
      <input
        aria-label={t('Name of {name}', { name: state.label })}
        defaultValue={state.label}
        maxLength={50}
        onBlur={(event) => {
          const label = event.target.value.trim();
          if (label && label !== state.label) onRename(label);
        }}
      />
      <select
        aria-label={t('Type of {name}', { name: state.label })}
        value={state.category}
        onChange={(event) => onCategory(event.target.value)}
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {t(c.label)}
          </option>
        ))}
      </select>
      <button
        className="button secondary small"
        type="button"
        disabled={first}
        onClick={() => onMove(-1)}
        aria-label={t('Move {name} earlier', { name: state.label })}
      >
        {t('Earlier')}
      </button>
      <button
        className="button secondary small"
        type="button"
        disabled={last}
        onClick={() => onMove(1)}
        aria-label={t('Move {name} later', { name: state.label })}
      >
        {t('Later')}
      </button>
      <select
        aria-label={t('Move tasks from {name} to', { name: state.label })}
        value={moveTo}
        onChange={(event) => setMoveTo(event.target.value)}
      >
        <option value="">{t('Delete: move its tasks to…')}</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        className="button danger small"
        type="button"
        onClick={() => onRemove(moveTo)}
      >
        {t('Delete')}
      </button>
    </li>
  );
}
