import type { ProjectContext } from '../auth/http';

/**
 * Guest label scopes (ADR-059). Every query that reads a task for a caller
 * adds this condition, so a scoped guest only ever sees tasks carrying one of
 * their labels. `param` is the placeholder holding the scope (or NULL).
 */
export function inScope(taskId: string, param: string): string {
  return `(${param}::uuid[] IS NULL OR EXISTS (SELECT 1 FROM task_labels sl
    WHERE sl.task_id = ${taskId} AND sl.label_id = ANY(${param}::uuid[])))`;
}

export function scopeOf(project: ProjectContext): string[] | null {
  return project.labelScope ?? null;
}
