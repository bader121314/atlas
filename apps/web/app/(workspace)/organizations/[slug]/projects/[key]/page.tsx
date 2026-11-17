'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Notice, value } from '../../../../../../components/form';
import { WorkflowSettings } from '../../../../../../components/workflow-settings';
import { api, describeFailure, priorityLabel } from '../../../../../../lib/api';
import type { Project, Task, WorkflowState } from '../../../../../../lib/api';

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

async function allTasks(base: string): Promise<Task[]> {
  const tasks: Task[] = [];
  let after: number | null = 0;
  // Keyset pages of 100 until the API reports no further page.
  for (let page = 0; after !== null && page < 20; page += 1) {
    const result: {
      data?: { tasks: Task[]; nextCursor: number | null } | undefined;
    } = await api<{ tasks: Task[]; nextCursor: number | null }>(
      `${base}/tasks?limit=100&after=${after}`,
    );
    if (!result.data) break;
    tasks.push(...result.data.tasks);
    after = result.data.nextCursor;
  }
  return tasks;
}

function TaskCard({ task, href }: { task: Task; href: string }) {
  return (
    <Link className="card" href={href}>
      <span className="key">{task.key}</span>
      <br />
      {task.title}
      <span className="meta">
        {task.priority !== 'none' ? (
          <span className={`priority-${task.priority}`}>
            {priorityLabel(task.priority)}
          </span>
        ) : null}
        {task.assignee ? <span>{task.assignee.displayName}</span> : null}
        {task.dueAt ? (
          <span>Due {day.format(new Date(task.dueAt))}</span>
        ) : null}
        {task.parent ? <span>Part of {task.parent.key}</span> : null}
        {task.labels.map((label) => (
          <span key={label.id} className={`label label-${label.color}`}>
            {label.name}
          </span>
        ))}
      </span>
    </Link>
  );
}

export default function ProjectPage() {
  const { slug, key } = useParams<{ slug: string; key: string }>();
  const base = `/organizations/${slug}/projects/${key}`;
  const [project, setProject] = useState<Project>();
  const [missing, setMissing] = useState(false);
  const [states, setStates] = useState<WorkflowState[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<Project>(base);
    if (!result.data) {
      setMissing(true);
      return;
    }
    setProject(result.data);
    const stateResult = await api<WorkflowState[]>(`${base}/states`);
    setStates(stateResult.data ?? []);
    setTasks(await allTasks(base));
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <>
        <h1>Project not found</h1>
        <p>It does not exist, or you do not have access to it.</p>
        <p>
          <Link href={`/organizations/${slug}`}>Back to the organization</Link>
        </p>
      </>
    );
  }
  if (!project) {
    return (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  }

  const canWrite =
    project.status === 'active' &&
    (project.role === 'manager' || project.role === 'editor');

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await api<Task>(`${base}/tasks`, {
      method: 'POST',
      body: { title: value(form, 'taskTitle') },
    });
    if (result.ok) {
      form.reset();
      setError('');
      setTasks(await allTasks(base));
      return;
    }
    setError(describeFailure(result.status, 'The task could not be created.'));
  }

  const href = (task: Task) => `${base}/tasks/${task.number}`;

  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>Organization</Link> /{' '}
        {project.key}
      </p>
      <h1>{project.name}</h1>
      {project.description ? <p>{project.description}</p> : null}
      {project.status === 'archived' ? (
        <Notice>
          <p>This project is archived. Tasks can be read but not changed.</p>
        </Notice>
      ) : null}

      {canWrite ? (
        <form className="inline-form section" onSubmit={addTask}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="taskTitle">New task</label>
            <input id="taskTitle" name="taskTitle" required maxLength={200} />
          </div>
          <button className="button" type="submit">
            Add task
          </button>
        </form>
      ) : null}

      <nav className="tabs" aria-label="Task views">
        {(['board', 'list'] as const).map((option) => (
          <a
            key={option}
            href={`#${option}`}
            aria-current={view === option ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              setView(option);
            }}
          >
            {option === 'board' ? 'Board' : 'List'}
          </a>
        ))}
      </nav>

      {tasks.length === 0 ? (
        <p className="muted">No tasks yet.</p>
      ) : view === 'board' ? (
        <div className="board">
          {states.map((state) => {
            const column = tasks.filter((task) => task.state.id === state.id);
            return (
              <section
                className="column"
                key={state.id}
                aria-label={state.label}
              >
                <h2>
                  {state.label} <span className="count">{column.length}</span>
                </h2>
                {column.map((task) => (
                  <TaskCard key={task.id} task={task} href={href(task)} />
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="rows">
          {tasks.map((task) => (
            <li key={task.id}>
              <span className="muted" style={{ width: '5.5rem' }}>
                {task.key}
              </span>
              <Link className="grow title" href={href(task)}>
                {task.title}
              </Link>
              <span>{task.state.label}</span>
              <span className={`priority-${task.priority}`}>
                {priorityLabel(task.priority)}
              </span>
              <span className="muted">
                {task.assignee?.displayName ?? 'Unassigned'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {project.role === 'manager' && project.status === 'active' ? (
        <WorkflowSettings
          base={base}
          states={states}
          onChange={async () => {
            const refreshed = await api<WorkflowState[]>(`${base}/states`);
            setStates(refreshed.data ?? []);
            setTasks(await allTasks(base));
          }}
        />
      ) : null}
    </>
  );
}
