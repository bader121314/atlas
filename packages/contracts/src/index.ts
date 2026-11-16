import { z } from 'zod';
export const healthSchema = z
  .object({
    status: z.literal('ok'),
    service: z.enum(['api', 'worker', 'web']),
  })
  .strict();
export type Health = z.infer<typeof healthSchema>;

const email = z.string().trim().toLowerCase().max(320).pipe(z.email());
// Length bounds per OWASP ASVS: at least 12 characters, at most 128 so hashing
// cost stays bounded. A breached-password check is planned (docs/05).
const password = z.string().min(12).max(128);

export const signupRequestSchema = z
  .object({
    email,
    password,
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const verifyEmailRequestSchema = z
  .object({ token: z.string().min(1).max(128) })
  .strict();
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const sessionResponseSchema = z
  .object({
    user: z
      .object({
        id: z.uuid(),
        email: z.string(),
        displayName: z.string(),
      })
      .strict(),
  })
  .strict();
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** Validates untrusted input; returns undefined instead of echoing details. */
export function parseRequest<T>(
  schema: z.ZodType<T>,
  input: unknown,
): T | undefined {
  const result = schema.safeParse(input);
  return result.success ? result.data : undefined;
}
