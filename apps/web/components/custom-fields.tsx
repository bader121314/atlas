'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import type { CustomField } from '../lib/api';
import { Notice, value } from './form';

const TYPE_LABELS: Record<CustomField['type'], string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Choice list',
};

const day = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

/** Display text for a stored value, or an empty string when unset. */
export function formatFieldValue(
  field: CustomField,
  stored: string | number | undefined,
): string {
  if (stored === undefined) return '';
  if (field.type === 'date' && typeof stored === 'string')
    return day.format(new Date(`${stored}T00:00:00Z`));
  return String(stored);
}

function splitOptions(text: string): string[] {
  return text
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
}

/** Managers define the project's extra task fields here. */
export function FieldsSection({
  base,
  fields,
  onChange,
}: {
  base: string;
  fields: CustomField[];
  onChange: () => Promise<void>;
}) {
  const [type, setType] = useState<CustomField['type']>('text');
  const [error, setError] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body: Record<string, unknown> = {
      name: value(form, 'fieldName'),
      type,
    };
    if (type === 'select')
      body.options = splitOptions(value(form, 'fieldOptions'));
    const result = await api(`${base}/fields`, { method: 'POST', body });
    setError(
      result.ok
        ? ''
        : describeFailure(
            result.status,
            result.status === 409
              ? 'A field with that name already exists, or the project has 20 fields.'
              : 'The field could not be added.',
          ),
    );
    if (result.ok) {
      form.reset();
      setType('text');
    }
    await onChange();
  }

  async function editOptions(field: CustomField) {
    const next = window.prompt(
      `Choices for ${field.name}, separated by commas. Tasks using a removed choice are cleared.`,
      field.options.join(', '),
    );
    if (next === null) return;
    const result = await api(`${base}/fields/${field.id}`, {
      method: 'PATCH',
      body: { options: splitOptions(next) },
    });
    setError(
      result.ok
        ? ''
        : describeFailure(result.status, 'The choices could not be saved.'),
    );
    await onChange();
  }

  async function remove(field: CustomField) {
    if (
      !window.confirm(
        `Delete ${field.name}? Its value is removed from every task.`,
      )
    )
      return;
    await api(`${base}/fields/${field.id}`, { method: 'DELETE' });
    await onChange();
  }

  return (
    <section className="section" aria-labelledby="fields-heading">
      <h2 id="fields-heading">Custom fields</h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {fields.length === 0 ? (
        <p className="muted">
          Add fields to track details your workflow needs, such as a region or
          an estimate.
        </p>
      ) : null}
      <ul className="rows">
        {fields.map((field) => (
          <li key={field.id}>
            <span className="grow">
              <span className="title">{field.name}</span>
              <br />
              <span className="muted">
                {TYPE_LABELS[field.type]}
                {field.type === 'select' ? `: ${field.options.join(', ')}` : ''}
              </span>
            </span>
            {field.type === 'select' ? (
              <button
                className="button secondary small"
                type="button"
                onClick={() => void editOptions(field)}
              >
                Edit choices
              </button>
            ) : null}
            <button
              className="button danger small"
              type="button"
              onClick={() => void remove(field)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form className="inline-form section" onSubmit={create}>
        <div className="field">
          <label htmlFor="fieldName">New field</label>
          <input id="fieldName" name="fieldName" required maxLength={40} />
        </div>
        <div className="field">
          <label htmlFor="fieldType">Type</label>
          <select
            id="fieldType"
            value={type}
            onChange={(event) =>
              setType(event.target.value as CustomField['type'])
            }
          >
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {type === 'select' ? (
          <div className="field">
            <label htmlFor="fieldOptions">Choices, separated by commas</label>
            <input id="fieldOptions" name="fieldOptions" required />
          </div>
        ) : null}
        <button className="button secondary" type="submit">
          Add field
        </button>
      </form>
    </section>
  );
}

/** One custom field's editor in the task sidebar; saves on change or blur. */
export function FieldInput({
  field,
  stored,
  disabled,
  version,
  onSave,
}: {
  field: CustomField;
  stored: string | number | undefined;
  disabled: boolean;
  version: number;
  onSave: (value: string | number | null) => Promise<void>;
}) {
  const id = `field-${field.id}`;
  const current = stored === undefined ? '' : String(stored);
  if (field.type === 'select') {
    return (
      <div className="field">
        <label htmlFor={id}>{field.name}</label>
        <select
          id={id}
          value={current}
          disabled={disabled}
          onChange={(event) => void onSave(event.target.value || null)}
        >
          <option value="">Not set</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{field.name}</label>
      <input
        id={id}
        key={`${version}-${field.id}`}
        type={field.type === 'text' ? 'text' : field.type}
        step={field.type === 'number' ? 'any' : undefined}
        maxLength={field.type === 'text' ? 500 : undefined}
        defaultValue={current}
        disabled={disabled}
        onBlur={(event) => {
          const raw = event.target.value.trim();
          if (raw === current) return;
          if (raw === '') void onSave(null);
          else void onSave(field.type === 'number' ? Number(raw) : raw);
        }}
      />
    </div>
  );
}
