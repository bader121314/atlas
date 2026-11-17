'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice, value } from './form';

interface Endpoint {
  id: string;
  url: string;
  description: string;
  events: string[];
  status: 'active' | 'paused';
  consecutiveFailures: number;
}

interface Delivery {
  id: string;
  eventType: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

const EVENTS = [
  ['task.created', 'Task created'],
  ['task.updated', 'Task changed'],
  ['comment.created', 'Comment added'],
] as const;

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'medium',
});

/** Owners and admins send signed events to other systems (ADR-036). */
export function WebhooksSection({ slug }: { slug: string }) {
  const base = `/organizations/${slug}/webhooks`;
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [open, setOpen] = useState<string>();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<Endpoint[]>(base);
    setEndpoints(result.data ?? []);
  }, [base]);

  const loadDeliveries = useCallback(
    async (id: string) => {
      const result = await api<Delivery[]>(`${base}/${id}/deliveries`);
      setDeliveries(result.data ?? []);
    },
    [base],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const events = EVENTS.map(([key]) => key).filter(
      (key) =>
        (form.elements.namedItem(`event-${key}`) as HTMLInputElement | null)
          ?.checked,
    );
    const result = await api<{ secret: string }>(base, {
      method: 'POST',
      body: {
        url: value(form, 'webhookUrl'),
        description: value(form, 'webhookDescription'),
        events,
      },
    });
    if (result.data) {
      setSecret(result.data.secret);
      setError('');
      form.reset();
    } else {
      setError(
        describeFailure(
          result.status,
          result.status === 400
            ? 'Use an https address on the public internet and choose at least one event.'
            : 'The endpoint could not be added.',
        ),
      );
    }
    await load();
  }

  async function act(
    endpoint: Endpoint,
    path: string,
    method: string,
    body?: unknown,
  ) {
    await api(`${base}/${endpoint.id}${path}`, {
      method,
      ...(body ? { body } : {}),
    });
    await load();
    if (open === endpoint.id) await loadDeliveries(endpoint.id);
  }

  return (
    <section className="section" aria-labelledby="webhooks-heading">
      <h2 id="webhooks-heading">Webhooks</h2>
      <p className="muted">
        Atlas sends a signed POST to each address when the chosen events happen.
        Verify the <code>X-Atlas-Signature</code> header with the endpoint
        secret.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {secret ? (
        <Notice>
          <p>
            Copy this signing secret now; it will not be shown again:{' '}
            <code className="secret">{secret}</code>
          </p>
          <button
            className="button secondary small"
            type="button"
            onClick={() => setSecret(undefined)}
          >
            I have saved it
          </button>
        </Notice>
      ) : null}
      <ul className="rows">
        {endpoints.map((endpoint) => (
          <li key={endpoint.id} className="stack">
            <span className="grow">
              <span className="title">{endpoint.url}</span>
              <br />
              <span className="muted">
                {endpoint.events.join(', ')}
                {endpoint.status === 'paused'
                  ? `, paused after ${endpoint.consecutiveFailures} failed attempts`
                  : ''}
              </span>
            </span>
            <span className="actions">
              <button
                className="button secondary small"
                type="button"
                onClick={() => {
                  const next = open === endpoint.id ? undefined : endpoint.id;
                  setOpen(next);
                  if (next) void loadDeliveries(next);
                }}
                aria-expanded={open === endpoint.id}
              >
                Deliveries
              </button>
              <button
                className="button secondary small"
                type="button"
                onClick={() => void act(endpoint, '/ping', 'POST')}
              >
                Send test
              </button>
              <button
                className="button secondary small"
                type="button"
                onClick={() =>
                  void act(endpoint, '', 'PATCH', {
                    status: endpoint.status === 'active' ? 'paused' : 'active',
                  })
                }
              >
                {endpoint.status === 'active' ? 'Pause' : 'Resume'}
              </button>
              <button
                className="button danger small"
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete the webhook to ${endpoint.url}?`))
                    void act(endpoint, '', 'DELETE');
                }}
              >
                Delete
              </button>
            </span>
            {open === endpoint.id ? (
              <table className="tasks-table">
                <caption>Recent deliveries</caption>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Result</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td>{d.eventType}</td>
                      <td>
                        {d.status}
                        {d.lastStatusCode
                          ? ` (${d.lastStatusCode})`
                          : d.lastError
                            ? ` (${d.lastError})`
                            : ''}
                      </td>
                      <td>{d.attempts}</td>
                      <td>{when.format(new Date(d.createdAt))}</td>
                      <td>
                        <button
                          className="button secondary small"
                          type="button"
                          onClick={() =>
                            void act(
                              endpoint,
                              `/deliveries/${d.id}/replay`,
                              'POST',
                            )
                          }
                        >
                          Send again
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </li>
        ))}
      </ul>
      <form className="form section" onSubmit={create}>
        <div className="field">
          <label htmlFor="webhookUrl">Endpoint address (https)</label>
          <input
            id="webhookUrl"
            name="webhookUrl"
            type="url"
            required
            maxLength={2000}
          />
        </div>
        <div className="field">
          <label htmlFor="webhookDescription">Description (optional)</label>
          <input
            id="webhookDescription"
            name="webhookDescription"
            maxLength={200}
          />
        </div>
        <fieldset className="checks plain">
          <legend>Events</legend>
          {EVENTS.map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                name={`event-${key}`}
                defaultChecked={key !== 'task.updated'}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <button className="button secondary" type="submit">
          Add webhook
        </button>
      </form>
    </section>
  );
}
