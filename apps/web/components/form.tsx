'use client';

import type { ReactNode } from 'react';

export function Field({
  label,
  name,
  type = 'text',
  hint,
  autoComplete,
  required = true,
  minLength,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        {...(autoComplete ? { autoComplete } : {})}
        {...(minLength ? { minLength } : {})}
        {...(defaultValue ? { defaultValue } : {})}
        {...(hintId ? { 'aria-describedby': hintId } : {})}
      />
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      className={tone === 'error' ? 'notice error' : 'notice'}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

/** Reads a named text field from a submitted form. */
export function value(form: HTMLFormElement, name: string): string {
  const input = form.elements.namedItem(name);
  return input instanceof HTMLInputElement || input instanceof HTMLSelectElement
    ? input.value
    : '';
}

/** Only same-site relative paths are followed after sign-in. */
export function safeNext(next: string | null): string {
  return next &&
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.startsWith('/\\')
    ? next
    : '/organizations';
}
