'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PRIORITIES, api, describeFailure, priorityLabel } from '../lib/api';
import type { Label, WorkflowState } from '../lib/api';
import { Notice, value } from './form';

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: string; toStateId?: string };
  conditions: { priorities?: string[] };
  actions: { type: string; [key: string]: unknown }[];
}

interface Member {
  userId: string;
  displayName: string;
}

/** Managers set up rules that change tasks when something happens (ADR-038). */
export function AutomationsSection({
  base,
  slug,
  states,
  labels,
}: {
  base: string;
  slug: string;
  states: WorkflowState[];
  labels: Label[];
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [trigger, setTrigger] = useState('task.created');
  const [action, setAction] = useState('set_priority');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      api<Rule[]>(`${base}/automations`),
      api<{ members: Member[] }>(`/organizations/${slug}/members`),
    ]);
    setRules(r.data ?? []);
    setMembers(m.data?.members ?? []);
  }, [base, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const stateName = (id?: string) =>
    states.find((s) => s.id === id)?.label ?? 'any status';

  function describe(rule: Rule): string {
    const when =
      rule.trigger.type === 'task.created'
        ? 'When a task is created'
        : rule.trigger.type === 'comment.created'
          ? 'When someone comments'
          : `When a task moves to ${stateName(rule.trigger.toStateId)}`;
    const only = rule.conditions.priorities
      ? ` with priority ${rule.conditions.priorities.map((p) => priorityLabel(p as never)).join(' or ')}`
      : '';
    const what = rule.actions
      .map((a) => {
        if (a.type === 'set_priority')
          return `set priority to ${priorityLabel(a.priority as never)}`;
        if (a.type === 'assign')
          return `assign ${members.find((m) => m.userId === a.userId)?.displayName ?? 'someone'}`;
        if (a.type === 'add_label')
          return `add ${labels.find((l) => l.id === a.labelId)?.name ?? 'a label'}`;
        if (a.type === 'set_state')
          return `move to ${stateName(a.stateId as string)}`;
        return 'add a comment';
      })
      .join(', ');
    return `${when}${only}: ${what}.`;
  }

  function rule(form: HTMLFormElement) {
    const toState = value(form, 'ruleToState');
    const priority = value(form, 'rulePriority');
    const param = value(form, 'ruleParam');
    const actionBody: Record<string, unknown> = { type: action };
    if (action === 'set_priority') actionBody.priority = param;
    if (action === 'assign') actionBody.userId = param;
    if (action === 'add_label') actionBody.labelId = param;
    if (action === 'set_state') actionBody.stateId = param;
    if (action === 'comment') actionBody.body = param;
    return {
      name: value(form, 'ruleName'),
      trigger:
        trigger === 'task.state_changed'
          ? { type: trigger, ...(toState ? { toStateId: toState } : {}) }
          : { type: trigger },
      conditions: priority ? { priorities: [priority] } : {},
      actions: [actionBody],
    };
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await api(`${base}/automations`, {
      method: 'POST',
      body: rule(form),
    });
    setError(
      result.ok
        ? ''
        : describeFailure(
            result.status,
            'The rule could not be saved. Check its choices.',
          ),
    );
    if (result.ok) {
      form.reset();
      setPreview('');
    }
    await load();
  }

  async function simulate(form: HTMLFormElement | null) {
    if (!form) return;
    const priority = value(form, 'rulePriority');
    const result = await api<{ matched: { key: string }[]; checked: number }>(
      `${base}/automations/simulate`,
      {
        method: 'POST',
        body: { conditions: priority ? { priorities: [priority] } : {} },
      },
    );
    if (result.data)
      setPreview(
        `${result.data.matched.length} of the latest ${result.data.checked} tasks match these conditions` +
          (result.data.matched.length
            ? `: ${result.data.matched
                .slice(0, 5)
                .map((m) => m.key)
                .join(', ')}`
            : '.'),
      );
  }

  const paramField = () => {
    if (action === 'set_priority')
      return (
        <select id="ruleParam" name="ruleParam">
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {priorityLabel(p)}
            </option>
          ))}
        </select>
      );
    if (action === 'assign')
      return (
        <select id="ruleParam" name="ruleParam" required>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </select>
      );
    if (action === 'add_label')
      return (
        <select id="ruleParam" name="ruleParam" required>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      );
    if (action === 'set_state')
      return (
        <select id="ruleParam" name="ruleParam" required>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      );
    return <input id="ruleParam" name="ruleParam" required maxLength={2000} />;
  };

  return (
    <section className="section" aria-labelledby="automations-heading">
      <h2 id="automations-heading">Automations</h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {rules.length === 0 ? <p className="muted">No rules yet.</p> : null}
      <ul className="rows">
        {rules.map((r) => (
          <li key={r.id}>
            <span className="grow">
              <span className="title">{r.name}</span>
              {r.enabled ? null : <span className="muted"> (off)</span>}
              <br />
              <span className="muted">{describe(r)}</span>
            </span>
            <button
              className="button secondary small"
              type="button"
              onClick={() =>
                void api(`${base}/automations/${r.id}`, {
                  method: 'PATCH',
                  body: { enabled: !r.enabled },
                }).then(load)
              }
            >
              {r.enabled ? 'Turn off' : 'Turn on'}
            </button>
            <button
              className="button danger small"
              type="button"
              onClick={() => {
                if (window.confirm(`Delete the rule ${r.name}?`))
                  void api(`${base}/automations/${r.id}`, {
                    method: 'DELETE',
                  }).then(load);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form className="form section" id="ruleForm" onSubmit={create}>
        <div className="field">
          <label htmlFor="ruleName">Rule name</label>
          <input id="ruleName" name="ruleName" required maxLength={80} />
        </div>
        <div className="inline-form">
          <div className="field">
            <label htmlFor="ruleTrigger">When</label>
            <select
              id="ruleTrigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
            >
              <option value="task.created">A task is created</option>
              <option value="task.state_changed">A task changes status</option>
              <option value="comment.created">Someone comments</option>
            </select>
          </div>
          {trigger === 'task.state_changed' ? (
            <div className="field">
              <label htmlFor="ruleToState">To status</label>
              <select id="ruleToState" name="ruleToState">
                <option value="">Any status</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="rulePriority">Only if priority is</label>
            <select id="rulePriority" name="rulePriority">
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="inline-form">
          <div className="field">
            <label htmlFor="ruleAction">Then</label>
            <select
              id="ruleAction"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="set_priority">Set priority</option>
              <option value="assign">Assign to</option>
              {labels.length > 0 ? (
                <option value="add_label">Add label</option>
              ) : null}
              <option value="set_state">Move to status</option>
              <option value="comment">Add a comment</option>
            </select>
          </div>
          <div className="field fill">
            <label htmlFor="ruleParam">
              {action === 'comment' ? 'Comment' : 'Value'}
            </label>
            {paramField()}
          </div>
        </div>
        {preview ? (
          <p className="muted" role="status">
            {preview}
          </p>
        ) : null}
        <div className="actions">
          <button
            className="button secondary"
            type="button"
            onClick={() =>
              void simulate(
                document.getElementById('ruleForm') as HTMLFormElement | null,
              )
            }
          >
            Preview matches
          </button>
          <button className="button" type="submit">
            Save rule
          </button>
        </div>
      </form>
    </section>
  );
}
