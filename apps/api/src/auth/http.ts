// Minimal HTTP shapes so the API does not depend on Express typings directly.
export interface HttpRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  /** Client address; X-Forwarded-For counts only from TRUST_PROXY proxies. */
  ip?: string;
  /** Set by the request logging middleware; echoed as X-Request-Id. */
  requestId?: string;
  params?: Record<string, string | undefined>;
  auth?: AuthContext;
  tenant?: TenantContext;
  project?: ProjectContext;
}

export interface HttpResponse {
  setHeader(name: string, value: string | string[]): void;
}

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; displayName: string };
  /** Set when the caller used an API token instead of a session (ADR-037). */
  token?: { id: string; organizationId: string; scopes: string[] };
}

/** Metadata key of RequirePermission; tenant routes are the only token routes. */
export const ORGANIZATION_PERMISSION = 'atlas:organization-permission';

/** The bearer token in the Authorization header, if any. */
export function bearerToken(request: HttpRequest): string | undefined {
  const value = header(request, 'authorization');
  const match = value ? /^Bearer\s+(\S+)$/i.exec(value) : null;
  return match?.[1];
}

/** Resolved by TenantGuard from the route, never from client-supplied ids. */
export interface TenantContext {
  organizationId: string;
  slug: string;
  role: string;
}

/** Resolved by ProjectGuard within the tenant, from the route key. */
export interface ProjectContext {
  id: string;
  key: string;
  role: 'manager' | 'editor' | 'commenter' | 'viewer';
  /** For scoped guests: the labels whose tasks they may see (ADR-059). */
  labelScope?: string[];
}

export function header(request: HttpRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function readCookie(
  request: HttpRequest,
  name: string,
): string | undefined {
  const cookies = header(request, 'cookie');
  if (!cookies) return undefined;
  for (const part of cookies.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}
