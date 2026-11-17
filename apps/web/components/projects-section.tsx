'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import type { Organization, Project } from '../lib/api';
import { Notice, value } from './form';

/** Projects on the organization page: list plus a create form. */
export function ProjectsSection({
  organization,
}: {
  organization: Organization;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState('');
  const base = `/organizations/${organization.slug}/projects`;
  const canCreate = organization.role !== 'guest';

  const load = useCallback(async () => {
    const result = await api<{ projects: Project[] }>(base);
    setProjects(result.data?.projects ?? []);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await api<Project>(base, {
      method: 'POST',
      body: {
        key: value(form, 'projectKey').toUpperCase(),
        name: value(form, 'projectName'),
        visibility: value(form, 'projectVisibility'),
      },
    });
    if (result.ok) {
      form.reset();
      setError('');
      await load();
      return;
    }
    setError(
      result.status === 409
        ? 'That project key is already used in this organization.'
        : describeFailure(
            result.status,
            'Use a key of 2–10 capital letters or digits, starting with a letter.',
          ),
    );
  }

  return (
    <section className="section" aria-labelledby="projects-heading">
      <h2 id="projects-heading">Projects</h2>
      {projects.length === 0 ? (
        <p className="muted">
          {canCreate
            ? 'No projects yet. Create the first one below.'
            : 'You have not been added to any projects yet.'}
        </p>
      ) : (
        <ul className="rows">
          {projects.map((project) => (
            <li key={project.id}>
              <span className="grow">
                <Link
                  className="title"
                  href={`/organizations/${organization.slug}/projects/${project.key}`}
                >
                  {project.name}
                </Link>
                <br />
                <span className="muted">
                  {project.key}
                  {project.visibility === 'private' ? ', private' : ''}
                  {project.status === 'archived' ? ', archived' : ''}
                </span>
              </span>
              <span className="role">{project.role}</span>
            </li>
          ))}
        </ul>
      )}
      {canCreate ? (
        <form className="inline-form section" onSubmit={create}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="field">
            <label htmlFor="projectName">Project name</label>
            <input
              id="projectName"
              name="projectName"
              required
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor="projectKey">Key</label>
            <input
              id="projectKey"
              name="projectKey"
              required
              minLength={2}
              maxLength={10}
              pattern="[A-Za-z][A-Za-z0-9]{1,9}"
              aria-describedby="projectKey-hint"
              style={{ textTransform: 'uppercase', width: '8rem' }}
            />
            <span className="hint" id="projectKey-hint">
              Prefix for task keys, e.g. NW-12
            </span>
          </div>
          <div className="field">
            <label htmlFor="projectVisibility">Who can see it</label>
            <select
              id="projectVisibility"
              name="projectVisibility"
              defaultValue="organization"
            >
              <option value="organization">Everyone in the organization</option>
              <option value="private">Only people I add</option>
            </select>
          </div>
          <button className="button" type="submit">
            Create project
          </button>
        </form>
      ) : null}
    </section>
  );
}
