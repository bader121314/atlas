import { Inject, Injectable } from '@nestjs/common';
import type { SearchResult } from '@atlas/contracts';
import type { TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

const LIMIT = 30;
const MAX_TERMS = 8;

/**
 * Turns free text into a prefix query: letters and digits only (any
 * script), every word required, each matching as a prefix. Returns
 * undefined when nothing searchable is left. The output contains no
 * operators from the input, so it is safe to pass to to_tsquery.
 */
export function toPrefixQuery(text: string): string | undefined {
  const words = text
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!words) return undefined;
  return [...new Set(words)]
    .slice(0, MAX_TERMS)
    .map((word) => `${word}:*`)
    .join(' & ');
}

/** "NW-12" style task keys, matched exactly before the text search. */
export function parseTaskKey(
  text: string,
): { projectKey: string; number: number } | undefined {
  const match = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/.exec(text.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return { projectKey: match[1].toUpperCase(), number: Number(match[2]) };
}

// Projects the caller can read, by the same rule as the project guard.
const READABLE = `p.organization_id = $1
  AND ($3 IN ('owner', 'admin') OR pm.user_id IS NOT NULL
       OR ($3 = 'member' AND p.visibility = 'organization'))`;

/** Organization-wide task search (ADR-032). */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async search(
    tenant: TenantContext,
    userId: string,
    text: string,
  ): Promise<SearchResult[]> {
    const query = toPrefixQuery(text);
    const key = parseTaskKey(text);
    if (!query && !key) return [];
    const result = await this.database.pool.query<{
      project_key: string;
      project_name: string;
      number: number;
      title: string;
      state: string;
      matched_in: 'task' | 'comment';
    }>(
      `WITH readable AS (
         SELECT p.id, p.key, p.name,
           -- Guests may be limited to labelled tasks (ADR-059).
           CASE WHEN $3 = 'guest' THEN pm.label_scope END AS scope
         FROM projects p
         LEFT JOIN project_memberships pm
           ON pm.project_id = p.id AND pm.user_id = $2
         WHERE ${READABLE}
       ),
       hits AS (
         SELECT t.id, 0 AS tier, 1.0::real AS rank, 'task' AS matched_in
         FROM tasks t JOIN readable r ON r.id = t.project_id
         WHERE t.organization_id = $1 AND r.key = $5 AND t.number = $6
         UNION ALL
         SELECT t.id, 1, ts_rank(t.search_vector, to_tsquery('simple', $4)), 'task'
         FROM tasks t JOIN readable r ON r.id = t.project_id
         WHERE $4::text IS NOT NULL AND t.organization_id = $1
           AND t.search_vector @@ to_tsquery('simple', $4)
         UNION ALL
         SELECT c.task_id, 2, ts_rank(c.search_vector, to_tsquery('simple', $4)), 'comment'
         FROM task_comments c
         JOIN tasks t ON t.organization_id = c.organization_id AND t.id = c.task_id
         JOIN readable r ON r.id = t.project_id
         WHERE $4::text IS NOT NULL AND c.organization_id = $1
           AND c.deleted_at IS NULL
           AND c.search_vector @@ to_tsquery('simple', $4)
       ),
       best AS (
         SELECT DISTINCT ON (id) id, tier, rank, matched_in FROM hits
         ORDER BY id, tier, rank DESC
       )
       SELECT r.key AS project_key, r.name AS project_name, t.number, t.title,
              ws.label AS state, b.matched_in
       FROM best b
       JOIN tasks t ON t.id = b.id
       JOIN readable r ON r.id = t.project_id
       JOIN workflow_states ws ON ws.id = t.state_id
       WHERE r.scope IS NULL OR EXISTS (SELECT 1 FROM task_labels sl
         WHERE sl.task_id = t.id AND sl.label_id = ANY(r.scope))
       ORDER BY b.tier, b.rank DESC, t.updated_at DESC, t.id
       LIMIT ${LIMIT}`,
      [
        tenant.organizationId,
        userId,
        tenant.role,
        query ?? null,
        key?.projectKey ?? null,
        key?.number ?? null,
      ],
    );
    return result.rows.map((row) => ({
      key: `${row.project_key}-${row.number}`,
      projectKey: row.project_key,
      projectName: row.project_name,
      number: row.number,
      title: row.title,
      state: row.state,
      matchedIn: row.matched_in,
    }));
  }
}
