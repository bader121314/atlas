'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../../lib/api';
import { useT } from '../../../../../lib/i18n';

interface Hit {
  key: string;
  projectKey: string;
  projectName: string;
  number: number;
  title: string;
  state: string;
  matchedIn: 'task' | 'comment';
}

function SearchResults() {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const [hits, setHits] = useState<Hit[]>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setHits(undefined);
      return;
    }
    let active = true;
    void api<Hit[]>(
      `/organizations/${slug}/search?q=${encodeURIComponent(q)}`,
    ).then((result) => {
      if (!active) return;
      if (result.status === 404) setMissing(true);
      setHits(result.data ?? []);
    });
    return () => {
      active = false;
    };
  }, [slug, q]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new FormData(event.currentTarget).get('q');
    router.replace(
      `/organizations/${slug}/search?q=${encodeURIComponent(String(next ?? ''))}`,
    );
  }

  if (missing) {
    return (
      <>
        <h1>{t('Organization not found')}</h1>
        <p>{t('It does not exist, or you are not a member.')}</p>
      </>
    );
  }

  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>{t('Organization')}</Link>{' '}
        {t('/ Search')}
      </p>
      <h1>{t('Search')}</h1>
      <form className="inline-form" role="search" onSubmit={submit}>
        <div className="field fill">
          <label htmlFor="searchQuery">{t('Search tasks and comments')}</label>
          <input
            id="searchQuery"
            name="q"
            type="search"
            defaultValue={q}
            key={q}
            maxLength={200}
            autoFocus
          />
        </div>
        <button className="button" type="submit">
          {t('Search')}
        </button>
      </form>
      {hits === undefined ? (
        <p className="muted">
          {t(
            'Type words from a title, description or comment, or a task key like NW-12.',
          )}
        </p>
      ) : hits.length === 0 ? (
        <p className="muted" role="status">
          No tasks match “{q}” in projects you can open.
        </p>
      ) : (
        <>
          <p className="muted" role="status">
            {hits.length === 1 ? '1 task' : `${hits.length} tasks`}
          </p>
          <ul className="rows">
            {hits.map((hit) => (
              <li key={hit.key}>
                <span className="muted key-cell">{hit.key}</span>
                <span className="grow">
                  <Link
                    className="title"
                    href={`/organizations/${slug}/projects/${hit.projectKey}/tasks/${hit.number}`}
                  >
                    {hit.title}
                  </Link>
                  <br />
                  <span className="muted">
                    {hit.projectName}, {hit.state}
                    {hit.matchedIn === 'comment'
                      ? ', matched in a comment'
                      : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchResults />
    </Suspense>
  );
}
