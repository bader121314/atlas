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

export const resendVerificationRequestSchema = z.object({ email }).strict();
export type ResendVerificationRequest = z.infer<
  typeof resendVerificationRequestSchema
>;

export const verifyEmailRequestSchema = z
  .object({ token: z.string().min(1).max(128) })
  .strict();
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const passwordResetRequestSchema = z.object({ email }).strict();
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z
  .object({ token: z.string().min(1).max(128), password })
  .strict();
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

export const resourceIdSchema = z.uuid();

export const sessionListResponseSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          id: z.uuid(),
          current: z.boolean(),
          issuedAt: z.iso.datetime(),
          lastSeenAt: z.iso.datetime().nullable(),
          expiresAt: z.iso.datetime(),
          userAgent: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const organizationSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);

export const createOrganizationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: organizationSlugSchema,
  })
  .strict();
export type CreateOrganizationRequest = z.infer<
  typeof createOrganizationRequestSchema
>;

export const updateOrganizationRequestSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();
export type UpdateOrganizationRequest = z.infer<
  typeof updateOrganizationRequestSchema
>;

const organizationRole = z.enum(['owner', 'admin', 'member', 'guest']);

export const organizationSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    role: organizationRole,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Organization = z.infer<typeof organizationSchema>;

export const organizationListResponseSchema = z
  .object({ organizations: z.array(organizationSchema) })
  .strict();
export type OrganizationListResponse = z.infer<
  typeof organizationListResponseSchema
>;

export const memberListResponseSchema = z
  .object({
    members: z.array(
      z
        .object({
          userId: z.uuid(),
          displayName: z.string(),
          email: z.string(),
          role: organizationRole,
          joinedAt: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict();
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

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
