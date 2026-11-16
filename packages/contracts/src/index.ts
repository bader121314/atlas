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

export const createInvitationRequestSchema = z
  .object({ email, role: z.enum(['admin', 'member', 'guest']) })
  .strict();
export type CreateInvitationRequest = z.infer<
  typeof createInvitationRequestSchema
>;

export const invitationSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    role: z.enum(['admin', 'member', 'guest']),
    invitedBy: z.string(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type Invitation = z.infer<typeof invitationSchema>;

export const invitationListResponseSchema = z
  .object({ invitations: z.array(invitationSchema) })
  .strict();
export type InvitationListResponse = z.infer<
  typeof invitationListResponseSchema
>;

export const acceptInvitationRequestSchema = z
  .object({ token: z.string().min(1).max(128) })
  .strict();

export const updateMemberRequestSchema = z
  .object({ role: organizationRole })
  .strict();
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const projectKeySchema = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/);
const projectRole = z.enum(['manager', 'editor', 'commenter', 'viewer']);
const projectVisibility = z.enum(['organization', 'private']);

export const createProjectRequestSchema = z
  .object({
    key: projectKeySchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).default(''),
    visibility: projectVisibility.default('organization'),
  })
  .strict();
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).optional(),
    visibility: projectVisibility.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict();
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    description: z.string(),
    visibility: projectVisibility,
    status: z.enum(['active', 'archived']),
    role: projectRole,
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;

export const projectListResponseSchema = z
  .object({ projects: z.array(projectSchema) })
  .strict();
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const setProjectMemberRequestSchema = z
  .object({ role: projectRole })
  .strict();

export const projectMemberListResponseSchema = z
  .object({
    members: z.array(
      z
        .object({
          userId: z.uuid(),
          displayName: z.string(),
          role: projectRole,
        })
        .strict(),
    ),
  })
  .strict();
export type ProjectMemberListResponse = z.infer<
  typeof projectMemberListResponseSchema
>;

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
