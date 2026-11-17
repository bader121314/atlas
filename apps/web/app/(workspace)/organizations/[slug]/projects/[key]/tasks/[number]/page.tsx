'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useShell } from '../../../../../../../../components/app-shell';
import { FieldInput } from '../../../../../../../../components/custom-fields';
import { Notice } from '../../../../../../../../components/form';
import { AttachmentsSection } from '../../../../../../../../components/attachments-section';
import { TimeSection } from '../../../../../../../../components/time-section';
import {
  formatDuration,
  parseDuration,
} from '../../../../../../../../lib/duration';
import { LiveStatusBadge } from '../../../../../../../../components/live-status';
import { useShortcuts } from '../../../../../../../../components/shortcuts';
import { useProjectEvents } from '../../../../../../../../lib/live';
import {
  presenceText,
  usePresence,
} from '../../../../../../../../lib/presence';
import {
  PRIORITIES,
  api,
  describeFailure,
  priorityLabel,
} from '../../../../../../../../lib/api';
import type {
  CustomField,
  Label,
  Milestone,
  Project,
  TaskRef,
  Task,
  WorkflowState,
} from '../../../../../../../../lib/api';
import {
  loadPendingEdit,
  mergeEdit,
  storePendingEdit,
} from '../../../../../../../../lib/offline-edits';
import type { PendingEdit } from '../../../../../../../../lib/offline-edits';

interface Comment {
  id: string;
  author: { userId: string; displayName: string };
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

interface Activity {
  id: string;
  action: string;
  actor: { displayName: string };
  changes: Record<string, unknown>;
  occurredAt: string;
}

interface Member {
  userId: string;
  displayName: string;
}

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** One readable line per history entry. */
function describe(entry: Activity, names: Map<string, string>): string {
  const who = entry.actor.displayName;
  switch (entry.action) {
    case 'task.created':
      return `${who} created the task`;
    case 'comment.created':
      return `${who} commented`;
    case 'comment.edited':
      return `${who} edited a comment`;
    case 'comment.deleted':
      return `${who} deleted a comment`;
    case 'dependency.added':
      return `${who} marked it blocked by task ${String(entry.changes.blockedBy)}`;
    case 'dependency.removed':
      return `${who} removed the blocker task ${String(entry.changes.blockedBy)}`;
    default: {
      const parts = Object.entries(entry.changes).map(([field, change]) => {
        if (change === true) return `changed the ${field}`;
        const { to } = change as { to: string | null };
        if (field === 'assignee')
          return to
            ? `assigned ${names.get(to) ?? 'someone'}`
            : 'unassigned it';
        if (field === 'dueAt')
          return to
            ? `set the due date to ${new Date(to).toLocaleDateString()}`
            : 'cleared the due date';
        if (field === 'estimate')
          return to
            ? `set the estimate to ${formatDuration(Number(to))}`
            : 'cleared the estimate';
        if (field === 'startAt')
          return to
            ? `set the start date to ${new Date(to).toLocaleDateString()}`
            : 'cleared the start date';
        if (field === 'state') return `moved it to ${to?.replace('_', ' ')}`;
        return `set ${field} to ${to}`;
      });
      return `${who} ${parts.join(', ') || 'updated the task'}`;
    }
  }
}

export default function TaskPage() {
  const { slug, key, number } = useParams<{
    slug: string;
    key: string;
    number: string;
  }>();
  const base = `/organizations/${slug}/projects/${key}`;
  const { user } = useShell();
  const router = useRouter();
  const shortcuts = useMemo(
    () => [
      {
        keys: 'c',
        description: 'Write a comment',
        run: () => document.getElementById('comment')?.focus(),
      },
      {
        keys: 'g p',
        description: 'Go back to the project',
        run: () => router.push(base),
      },
    ],
    [router, base],
  );
  useShortcuts('task', shortcuts);
  const [project, setProject] = useState<Project>();
  const [task, setTask] = useState<Task>();
  const [missing, setMissing] = useState(false);
  const [states, setStates] = useState<WorkflowState[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [deps, setDeps] = useState<{
    blockedBy: TaskRef[];
    blocking: TaskRef[];
  }>({
    blockedBy: [],
    blocking: [],
  });
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<Activity[]>([]);
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();

  const loadThread = useCallback(async () => {
    const [c, h] = await Promise.all([
      api<Comment[]>(`${base}/tasks/${number}/comments`),
      api<Activity[]>(`${base}/tasks/${number}/activity`),
    ]);
    setComments(c.data ?? []);
    setHistory(h.data ?? []);
    const d = await api<{ blockedBy: TaskRef[]; blocking: TaskRef[] }>(
      `${base}/tasks/${number}/dependencies`,
    );
    if (d.data) setDeps(d.data);
  }, [base, number]);

  const load = useCallback(async () => {
    const [p, t, s, m, l] = await Promise.all([
      api<Project>(base),
      api<Task>(`${base}/tasks/${number}`),
      api<WorkflowState[]>(`${base}/states`),
      api<{ members: Member[] }>(`/organizations/${slug}/members`),
      api<Label[]>(`/organizations/${slug}/labels`),
    ]);
    if (!p.data || !t.data) {
      setMissing(true);
      return;
    }
    setProject(p.data);
    setTask(t.data);
    setStates(s.data ?? []);
    setMembers(m.data?.members ?? []);
    setLabels(l.data ?? []);
    const [ms, f] = await Promise.all([
      api<Milestone[]>(`${base}/milestones`),
      api<CustomField[]>(`${base}/fields`),
    ]);
    setMilestones(ms.data ?? []);
    setFields(f.data ?? []);
    await loadThread();
  }, [base, number, slug, loadThread]);

  const pendingKey = `${slug}/${key}/${number}`;
  const [pending, setPending] = useState<PendingEdit>();
  useEffect(() => {
    setPending(loadPendingEdit(pendingKey));
  }, [pendingKey]);

  // Back online: send the kept changes once, based on the version they
  // were made against, so someone else's newer edit is never overwritten.
  useEffect(() => {
    if (!pending) return;
    const flush = async () => {
      if (!navigator.onLine) return;
      const result = await api<Task>(`${base}/tasks/${number}`, {
        method: 'PATCH',
        body: { version: pending.version, ...pending.changes },
      });
      if (result.status === 0) return;
      setPending(undefined);
      storePendingEdit(pendingKey, undefined);
      if (result.data) {
        setTask(result.data);
        setMessage({ tone: 'info', text: 'Saved your offline changes.' });
        await loadThread();
        return;
      }
      const fresh = await api<Task>(`${base}/tasks/${number}`);
      if (fresh.data) setTask(fresh.data);
      setMessage({
        tone: 'error',
        text:
          result.status === 409
            ? 'Your offline changes were not saved because someone else changed this task meanwhile. Their version is shown; apply yours again if still needed.'
            : 'Your offline changes could not be saved.',
      });
    };
    void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [pending, pendingKey, base, number, loadThread]);

  useEffect(() => {
    void load();
  }, [load]);

  const [stale, setStale] = useState(false);
  const showLatest = useCallback(async () => {
    const fresh = await api<Task>(`${base}/tasks/${number}`);
    if (fresh.data) setTask(fresh.data);
    setStale(false);
    await loadThread();
  }, [base, number, loadThread]);
  const viewers = usePresence(`${base}/tasks/${number}/presence`, user.id);
  const live = useProjectEvents(base, {
    onEvent: (event) => {
      if (!task || event.taskId !== task.id) return;
      if (event.actorUserId === user.id) return;
      // Replacing the form would throw away text being typed: ask instead.
      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        (active instanceof HTMLTextAreaElement && active.id !== 'comment');
      if (typing && event.version > task.version) setStale(true);
      else void showLatest();
    },
    onResync: () => void load(),
    onRevoked: () => setMissing(true),
  });

  if (missing) {
    return (
      <>
        <h1>Task not found</h1>
        <p>It does not exist, or you do not have access to its project.</p>
        <p>
          <Link href={base}>Back to the project</Link>
        </p>
      </>
    );
  }
  if (!task || !project) {
    return (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  }

  const canWrite =
    project.status === 'active' &&
    (project.role === 'manager' || project.role === 'editor');
  const canComment = project.role !== 'viewer';
  const names = new Map(members.map((m) => [m.userId, m.displayName]));

  function keepOffline(changes: Record<string, unknown>) {
    if (!task) return;
    const next = mergeEdit(pending, task.version, changes);
    setPending(next);
    storePendingEdit(pendingKey, next);
    setMessage({
      tone: 'info',
      text: 'You are offline. Your changes are kept on this device and will be saved when the connection returns.',
    });
  }

  async function save(changes: Record<string, unknown>, success: string) {
    if (!task) return;
    // Offline (ADR-061): keep the change and send it when back online.
    if (pending || !navigator.onLine) {
      keepOffline(changes);
      return;
    }
    const result = await api<Task>(`${base}/tasks/${number}`, {
      method: 'PATCH',
      body: { version: task.version, ...changes },
    });
    if (result.status === 0) {
      keepOffline(changes);
      return;
    }
    if (result.data) {
      setTask(result.data);
      setMessage({ tone: 'info', text: success });
      await loadThread();
      return;
    }
    if (result.status === 409) {
      // Someone else saved first: show their version instead of overwriting.
      const fresh = await api<Task>(`${base}/tasks/${number}`);
      if (fresh.data) setTask(fresh.data);
      setMessage({
        tone: 'error',
        text: 'Someone else changed this task while you were editing. Their changes are now shown; apply yours again if still needed.',
      });
      return;
    }
    setMessage({
      tone: 'error',
      text: describeFailure(result.status, 'The change could not be saved.'),
    });
  }

  async function toggleAssignee(userId: string, checked: boolean) {
    if (!task) return;
    const ids = task.assignees
      .map((a) => a.userId)
      .filter((id) => id !== userId);
    if (checked) ids.push(userId);
    const result = await api<Task>(`${base}/tasks/${number}/assignees`, {
      method: 'PUT',
      body: { userIds: ids },
    });
    if (result.data) {
      setTask(result.data);
      setMessage({ tone: 'info', text: 'Assignees changed.' });
      await loadThread();
    } else {
      setMessage({
        tone: 'error',
        text: describeFailure(result.status, 'Assignees could not be changed.'),
      });
    }
  }

  async function toggleLabel(label: Label, checked: boolean) {
    if (!task) return;
    const ids = new Set(task.labels.map((l) => l.id));
    if (checked) ids.add(label.id);
    else ids.delete(label.id);
    const result = await api<Task>(`${base}/tasks/${number}/labels`, {
      method: 'PUT',
      body: { labelIds: [...ids] },
    });
    if (result.data) {
      setTask(result.data);
      await loadThread();
    } else {
      setMessage({
        tone: 'error',
        text: describeFailure(result.status, 'Labels could not be changed.'),
      });
    }
  }

  async function saveField(field: CustomField, next: string | number | null) {
    const result = await api<Task>(
      `${base}/tasks/${number}/fields/${field.id}`,
      {
        method: 'PUT',
        body: { value: next },
      },
    );
    if (result.data) {
      setTask(result.data);
      setMessage({ tone: 'info', text: `${field.name} saved.` });
      await loadThread();
    } else {
      setMessage({
        tone: 'error',
        text: describeFailure(
          result.status,
          `${field.name} could not be saved. Check the value and try again.`,
        ),
      });
    }
  }

  async function addBlocker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const blockerNumber = Number(new FormData(form).get('blocker'));
    const result = await api(`${base}/tasks/${number}/dependencies`, {
      method: 'POST',
      body: { blockerNumber },
    });
    if (result.ok) {
      form.reset();
      await loadThread();
      return;
    }
    setMessage({
      tone: 'error',
      text:
        result.status === 400
          ? `${key}-${blockerNumber} cannot block this task: it does not exist, or it already depends on this task.`
          : describeFailure(
              result.status,
              'The dependency could not be added.',
            ),
    });
  }

  async function removeBlocker(blocker: number) {
    await api(`${base}/tasks/${number}/dependencies/${blocker}`, {
      method: 'DELETE',
    });
    await loadThread();
  }

  async function saveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await save(
      {
        title: String(form.get('title') ?? ''),
        description: String(form.get('description') ?? ''),
      },
      'Task saved.',
    );
  }

  function mention(userId: string) {
    const person = members.find((m) => m.userId === userId);
    const box = document.getElementById(
      'comment',
    ) as HTMLTextAreaElement | null;
    if (!person || !box) return;
    box.value = `${box.value}${box.value && !box.value.endsWith(' ') ? ' ' : ''}@${person.displayName} `;
    box.focus();
  }

  async function comment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('comment') ?? '');
    // Everyone named as "@Display Name" in the text is notified.
    const mentions = members
      .filter((m) => m.userId !== user.id && body.includes(`@${m.displayName}`))
      .map((m) => m.userId);
    const result = await api(`${base}/tasks/${number}/comments`, {
      method: 'POST',
      body: { body, mentions },
    });
    if (result.ok) {
      form.reset();
      await loadThread();
    } else {
      setMessage({
        tone: 'error',
        text: describeFailure(
          result.status,
          result.status === 400
            ? 'The comment could not be posted. Check that everyone you mentioned can open this project.'
            : 'The comment could not be posted.',
        ),
      });
    }
  }

  async function removeComment(id: string) {
    if (!window.confirm('Delete this comment?')) return;
    await api(`${base}/tasks/${number}/comments/${id}`, { method: 'DELETE' });
    await loadThread();
  }

  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>Organization</Link> /{' '}
        <Link href={base}>{project.name}</Link> / {task.key}
      </p>
      <LiveStatusBadge status={live} />
      {viewers.length > 0 ? (
        <p className="presence" aria-live="polite">
          {presenceText(viewers)}
        </p>
      ) : null}
      {stale ? (
        <Notice>
          <p>
            Someone else changed this task while you were typing. Your text is
            kept until you choose.
          </p>
          <button
            className="button secondary small"
            type="button"
            onClick={() => void showLatest()}
          >
            Show the latest version
          </button>
        </Notice>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="task-layout section">
        <div>
          {canWrite ? (
            <form className="form wide" onSubmit={saveText} key={task.version}>
              <div className="field">
                <label htmlFor="title">Title</label>
                <input
                  id="title"
                  name="title"
                  defaultValue={task.title}
                  required
                  maxLength={200}
                />
              </div>
              <div className="field">
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  name="description"
                  defaultValue={task.description}
                  maxLength={20000}
                />
              </div>
              <p>
                <button className="button secondary" type="submit">
                  Save task
                </button>
              </p>
            </form>
          ) : (
            <>
              <h1>{task.title}</h1>
              <p className="prewrap">{task.description || 'No description.'}</p>
            </>
          )}

          <section className="section" aria-labelledby="deps-heading">
            <h2 id="deps-heading">Dependencies</h2>
            {deps.blockedBy.length === 0 && deps.blocking.length === 0 ? (
              <p className="muted">This task does not depend on other tasks.</p>
            ) : null}
            {deps.blockedBy.length > 0 ? (
              <>
                <h3>Blocked by</h3>
                <ul className="rows">
                  {deps.blockedBy.map((d) => (
                    <li key={d.number}>
                      <Link className="grow" href={`${base}/tasks/${d.number}`}>
                        {d.key} {d.title}
                      </Link>
                      <span className="muted">{d.done ? 'Done' : 'Open'}</span>
                      {canWrite ? (
                        <button
                          className="button secondary small"
                          type="button"
                          onClick={() => void removeBlocker(d.number)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {deps.blocking.length > 0 ? (
              <>
                <h3 className="section">Blocking</h3>
                <ul className="rows">
                  {deps.blocking.map((d) => (
                    <li key={d.number}>
                      <Link className="grow" href={`${base}/tasks/${d.number}`}>
                        {d.key} {d.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {canWrite ? (
              <form className="inline-form section" onSubmit={addBlocker}>
                <div className="field">
                  <label htmlFor="blocker">Blocked by task number</label>
                  <input
                    id="blocker"
                    name="blocker"
                    type="number"
                    min={1}
                    required
                  />
                </div>
                <button className="button secondary" type="submit">
                  Add blocker
                </button>
              </form>
            ) : null}
          </section>

          <AttachmentsSection
            base={base}
            number={number}
            userId={user.id}
            canWrite={canWrite}
            canManage={project.role === 'manager'}
          />

          <TimeSection
            base={base}
            number={number}
            userId={user.id}
            canWrite={canWrite}
            canManage={project.role === 'manager'}
            estimateMinutes={task.estimateMinutes}
          />

          <section className="section" aria-labelledby="comments-heading">
            <h2 id="comments-heading">Comments</h2>
            {comments.length === 0 ? (
              <p className="muted">No comments yet.</p>
            ) : null}
            <ul className="thread">
              {comments.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.author.displayName}</strong>{' '}
                  <span className="muted">
                    {when.format(new Date(entry.createdAt))}
                    {entry.editedAt ? ', edited' : ''}
                  </span>
                  {entry.deleted ? (
                    <p className="muted">This comment was deleted.</p>
                  ) : (
                    <p className="prewrap">{entry.body}</p>
                  )}
                  {!entry.deleted &&
                  (entry.author.userId === user.id ||
                    project.role === 'manager') ? (
                    <button
                      className="button secondary small"
                      type="button"
                      onClick={() => void removeComment(entry.id)}
                    >
                      Delete
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canComment ? (
              <form className="form wide" onSubmit={comment}>
                <div className="field">
                  <label htmlFor="comment">Add a comment</label>
                  <textarea
                    id="comment"
                    name="comment"
                    required
                    maxLength={10000}
                  />
                </div>
                <div className="inline-form">
                  <div className="field">
                    <label htmlFor="mention">Mention someone</label>
                    <select
                      id="mention"
                      value=""
                      onChange={(event) => mention(event.target.value)}
                    >
                      <option value="">Choose a person</option>
                      {members
                        .filter((m) => m.userId !== user.id)
                        .map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.displayName}
                          </option>
                        ))}
                    </select>
                  </div>
                  <button className="button" type="submit">
                    Post comment
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          <section className="section" aria-labelledby="history-heading">
            <h2 id="history-heading">History</h2>
            <ul className="history">
              {history.map((entry) => (
                <li key={entry.id}>
                  {describe(entry, names)}{' '}
                  <span>({when.format(new Date(entry.occurredAt))})</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="task-side" aria-label="Task details">
          <div className="field">
            <label htmlFor="state">Status</label>
            <select
              id="state"
              value={task.state.id}
              disabled={!canWrite}
              onChange={(event) =>
                void save({ stateId: event.target.value }, 'Status changed.')
              }
            >
              {states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="priority">Priority</label>
            <select
              id="priority"
              value={task.priority}
              disabled={!canWrite}
              onChange={(event) =>
                void save({ priority: event.target.value }, 'Priority changed.')
              }
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabel(priority)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="assignee">Assignee</label>
            <select
              id="assignee"
              value={task.assignee?.userId ?? ''}
              disabled={!canWrite}
              onChange={(event) =>
                void save(
                  { assigneeId: event.target.value || null },
                  'Assignee changed.',
                )
              }
            >
              <option value="">Unassigned</option>
              {task.assignee && !names.has(task.assignee.userId) ? (
                <option value={task.assignee.userId}>
                  {task.assignee.displayName}
                </option>
              ) : null}
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </div>
          {task.assignee && members.length > 1 ? (
            <fieldset className="checks plain">
              <legend>Also assigned</legend>
              {members
                .filter((m) => m.userId !== task.assignee?.userId)
                .map((member) => (
                  <label key={member.userId}>
                    <input
                      type="checkbox"
                      disabled={!canWrite}
                      checked={task.assignees.some(
                        (a) => a.userId === member.userId,
                      )}
                      onChange={(event) =>
                        void toggleAssignee(member.userId, event.target.checked)
                      }
                    />
                    {member.displayName}
                  </label>
                ))}
            </fieldset>
          ) : null}
          <div className="field">
            <label htmlFor="estimate">Estimate</label>
            <input
              id="estimate"
              disabled={!canWrite}
              placeholder="e.g. 4h"
              autoComplete="off"
              defaultValue={
                task.estimateMinutes === null
                  ? ''
                  : formatDuration(task.estimateMinutes)
              }
              key={`${task.version}-estimate`}
              onBlur={(event) => {
                const text = event.target.value.trim();
                const minutes = text === '' ? null : parseDuration(text, 60000);
                if (minutes === undefined) {
                  setMessage({
                    tone: 'error',
                    text: 'Enter an estimate like 45m, 4h or 2h 30m, up to 1000 hours.',
                  });
                  return;
                }
                if (minutes === task.estimateMinutes) return;
                void save({ estimateMinutes: minutes }, 'Estimate changed.');
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="start">Start date</label>
            <input
              id="start"
              type="date"
              disabled={!canWrite}
              defaultValue={task.startAt?.slice(0, 10) ?? ''}
              max={task.dueAt?.slice(0, 10)}
              key={`${task.version}-start`}
              onChange={(event) =>
                void save(
                  {
                    startAt: event.target.value
                      ? `${event.target.value}T12:00:00Z`
                      : null,
                  },
                  'Start date changed.',
                )
              }
            />
          </div>
          <div className="field">
            <label htmlFor="due">Due date</label>
            <input
              id="due"
              type="date"
              disabled={!canWrite}
              defaultValue={task.dueAt?.slice(0, 10) ?? ''}
              min={task.startAt?.slice(0, 10)}
              key={`${task.version}-due`}
              onChange={(event) =>
                void save(
                  {
                    dueAt: event.target.value
                      ? `${event.target.value}T12:00:00Z`
                      : null,
                  },
                  'Due date changed.',
                )
              }
            />
          </div>
          {labels.length > 0 ? (
            <fieldset className="checks plain">
              <legend>Labels</legend>
              {labels.map((label) => (
                <label key={label.id}>
                  <input
                    type="checkbox"
                    disabled={!canWrite}
                    checked={task.labels.some((l) => l.id === label.id)}
                    onChange={(event) =>
                      void toggleLabel(label, event.target.checked)
                    }
                  />
                  <span className={`label label-${label.color}`}>
                    {label.name}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {milestones.length > 0 ? (
            <div className="field">
              <label htmlFor="milestone">Milestone</label>
              <select
                id="milestone"
                value={task.milestone?.id ?? ''}
                disabled={!canWrite}
                onChange={(event) =>
                  void save(
                    { milestoneId: event.target.value || null },
                    'Milestone changed.',
                  )
                }
              >
                <option value="">No milestone</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {fields.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              stored={task.fields[field.id]}
              disabled={!canWrite}
              version={task.version}
              onSave={(next) => saveField(field, next)}
            />
          ))}
          <div className="field">
            <label htmlFor="parent">Part of task number</label>
            <input
              id="parent"
              type="number"
              min={1}
              disabled={!canWrite}
              defaultValue={task.parent?.number ?? ''}
              key={`${task.version}-parent`}
              onBlur={(event) => {
                const next = event.target.value
                  ? Number(event.target.value)
                  : null;
                if (next !== (task.parent?.number ?? null)) {
                  void save(
                    { parentNumber: next },
                    next
                      ? `Now part of ${key}-${next}.`
                      : 'No longer a subtask.',
                  );
                }
              }}
            />
          </div>
          {task.completedAt ? (
            <p className="muted">
              Completed {when.format(new Date(task.completedAt))}
            </p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
