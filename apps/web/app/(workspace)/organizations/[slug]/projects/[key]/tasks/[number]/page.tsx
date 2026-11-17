'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useShell } from '../../../../../../../../components/app-shell';
import { Notice } from '../../../../../../../../components/form';
import {
  PRIORITIES,
  api,
  describeFailure,
  priorityLabel,
} from '../../../../../../../../lib/api';
import type {
  Project,
  Task,
  WorkflowState,
} from '../../../../../../../../lib/api';

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
  const [project, setProject] = useState<Project>();
  const [task, setTask] = useState<Task>();
  const [missing, setMissing] = useState(false);
  const [states, setStates] = useState<WorkflowState[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
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
  }, [base, number]);

  const load = useCallback(async () => {
    const [p, t, s, m] = await Promise.all([
      api<Project>(base),
      api<Task>(`${base}/tasks/${number}`),
      api<WorkflowState[]>(`${base}/states`),
      api<{ members: Member[] }>(`/organizations/${slug}/members`),
    ]);
    if (!p.data || !t.data) {
      setMissing(true);
      return;
    }
    setProject(p.data);
    setTask(t.data);
    setStates(s.data ?? []);
    setMembers(m.data?.members ?? []);
    await loadThread();
  }, [base, number, slug, loadThread]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function save(changes: Record<string, unknown>, success: string) {
    if (!task) return;
    const result = await api<Task>(`${base}/tasks/${number}`, {
      method: 'PATCH',
      body: { version: task.version, ...changes },
    });
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

  async function comment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('comment') ?? '');
    const result = await api(`${base}/tasks/${number}/comments`, {
      method: 'POST',
      body: { body },
    });
    if (result.ok) {
      form.reset();
      await loadThread();
    } else {
      setMessage({
        tone: 'error',
        text: describeFailure(
          result.status,
          'The comment could not be posted.',
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
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="task-layout section">
        <div>
          {canWrite ? (
            <form
              className="form"
              style={{ maxWidth: 'none' }}
              onSubmit={saveText}
              key={task.version}
            >
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
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {task.description || 'No description.'}
              </p>
            </>
          )}

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
                    <p style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</p>
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
              <form
                className="form"
                style={{ maxWidth: 'none' }}
                onSubmit={comment}
              >
                <div className="field">
                  <label htmlFor="comment">Add a comment</label>
                  <textarea
                    id="comment"
                    name="comment"
                    required
                    maxLength={10000}
                  />
                </div>
                <p>
                  <button className="button" type="submit">
                    Post comment
                  </button>
                </p>
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
          <div className="field">
            <label htmlFor="due">Due date</label>
            <input
              id="due"
              type="date"
              disabled={!canWrite}
              defaultValue={task.dueAt?.slice(0, 10) ?? ''}
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
