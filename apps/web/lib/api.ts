// Thin client for the same-origin API proxy. Responses are typed by caller;
// the server validates everything, so the UI never trusts its own checks.
export interface ApiResult<T> {
  status: number;
  ok: boolean;
  /** Parsed body of a successful (2xx) response; always undefined otherwise. */
  data: T | undefined;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
  };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    return { status: 0, ok: false, data: undefined };
  }
  const text = await response.text();
  let data: T | undefined;
  // Error responses carry an RFC 9457 problem body, never the requested data,
  // so only successful responses populate `data`.
  if (response.ok && text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = undefined;
    }
  }
  return { status: response.status, ok: response.ok, data };
}

/** Plain-language messages for status codes shared by every form. */
export function describeFailure(status: number, fallback: string): string {
  switch (status) {
    case 0:
      return 'Atlas could not be reached. Check your connection and try again.';
    case 429:
      return 'Too many attempts. Wait a few minutes, then try again.';
    case 503:
      return 'Atlas is temporarily unavailable. Try again shortly.';
    default:
      return fallback;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  createdAt: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  visibility: 'organization' | 'private';
  status: 'active' | 'archived';
  role: 'manager' | 'editor' | 'commenter' | 'viewer';
  version: number;
}

export interface WorkflowState {
  id: string;
  key: string;
  label: string;
  category: 'todo' | 'in_progress' | 'done';
  position: number;
}

export interface Task {
  id: string;
  key: string;
  number: number;
  title: string;
  description: string;
  state: WorkflowState;
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
  assignee: { userId: string; displayName: string } | null;
  dueAt: string | null;
  completedAt: string | null;
  parent: { number: number; key: string } | null;
  labels: Label[];
  version: number;
}

export interface Label {
  id: string;
  name: string;
  color: 'slate' | 'sea' | 'sage' | 'sand' | 'rose' | 'violet';
}

export const PRIORITIES: Task['priority'][] = [
  'none',
  'low',
  'medium',
  'high',
  'urgent',
];

/** Same priority words everywhere in the interface. */
export function priorityLabel(priority: Task['priority']): string {
  return priority === 'none'
    ? 'No priority'
    : priority.charAt(0).toUpperCase() + priority.slice(1);
}
