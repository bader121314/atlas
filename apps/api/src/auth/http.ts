// Minimal HTTP shapes so the API does not depend on Express typings directly.
export interface HttpRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  auth?: AuthContext;
}

export interface HttpResponse {
  setHeader(name: string, value: string | string[]): void;
}

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; displayName: string };
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
