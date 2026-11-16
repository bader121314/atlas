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
