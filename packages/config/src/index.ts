import { z } from 'zod';
const port = z.coerce.number().int().min(1).max(65535);
function hasProtocol(value: string, allowed: string[]): boolean {
  try {
    return allowed.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_PORT: port.default(3001),
  WORKER_PORT: port.default(3002),
  /** Interface to listen on: loopback by default, 0.0.0.0 in containers. */
  LISTEN_HOST: z
    .union([z.literal('127.0.0.1'), z.literal('0.0.0.0'), z.literal('::')])
    .default('127.0.0.1'),
  DATABASE_URL: z
    .url()
    .refine((v) => hasProtocol(v, ['postgres:', 'postgresql:'])),
  REDIS_URL: z.url().refine((v) => hasProtocol(v, ['redis:', 'rediss:'])),
});
export type Environment = z.infer<typeof environmentSchema>;
export function parseEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Report field names only: database/Redis URLs may contain credentials.
    throw new Error(
      'Invalid environment: ' +
        [...new Set(result.error.issues.map((i) => i.path.join('.')))].join(
          ', ',
        ),
    );
  }
  return result.data;
}

// Authentication settings are validated separately so infrastructure-only
// processes (worker, health checks) do not require auth secrets.
export const authEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  SESSION_SECRET: z.string().min(32),
  WEB_ORIGIN: z.url().refine((v) => {
    try {
      const url = new URL(v);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === v;
    } catch {
      return false;
    }
  }),
});
export type AuthEnvironment = z.infer<typeof authEnvironmentSchema>;
export function parseAuthEnvironment(
  input: Record<string, unknown>,
): AuthEnvironment {
  const result = authEnvironmentSchema.safeParse(input);
  if (!result.success) {
    // Field names only: SESSION_SECRET must never appear in errors or logs.
    throw new Error(
      'Invalid auth environment: ' +
        [...new Set(result.error.issues.map((i) => i.path.join('.')))].join(
          ', ',
        ),
    );
  }
  return result.data;
}
