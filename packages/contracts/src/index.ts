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

const priority = z.enum(['none', 'low', 'medium', 'high', 'urgent']);
export const labelColorSchema = z.enum([
  'slate',
  'sea',
  'sage',
  'sand',
  'rose',
  'violet',
]);
export const createLabelRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    color: labelColorSchema.default('sea'),
  })
  .strict();
export const labelSchema = z
  .object({ id: z.uuid(), name: z.string(), color: labelColorSchema })
  .strict();
export type Label = z.infer<typeof labelSchema>;
export const setTaskLabelsRequestSchema = z
  .object({ labelIds: z.array(z.uuid()).max(20) })
  .strict();
const parentNumber = z.number().int().positive().nullable();

export const createTaskRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000).default(''),
    stateId: z.uuid().optional(),
    priority: priority.default('none'),
    assigneeId: z.uuid().nullable().default(null),
    dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
    parentNumber: parentNumber.default(null),
    milestoneId: z.uuid().nullable().default(null),
  })
  .strict();
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20000).optional(),
    stateId: z.uuid().optional(),
    priority: priority.optional(),
    assigneeId: z.uuid().nullable().optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    parentNumber: parentNumber.optional(),
    milestoneId: z.uuid().nullable().optional(),
  })
  .strict();
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const taskQuerySchema = z
  .object({
    state: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    assignee: z.union([z.uuid(), z.enum(['me', 'none'])]).optional(),
    priority: priority.optional(),
    label: z.uuid().optional(),
    milestone: z.union([z.uuid(), z.literal('none')]).optional(),
    parent: z
      .union([z.coerce.number().int().positive(), z.literal('none')])
      .optional(),
    after: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type TaskQuery = z.infer<typeof taskQuerySchema>;

export const workflowStateSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    label: z.string(),
    category: z.enum(['todo', 'in_progress', 'done']),
    position: z.number().int(),
  })
  .strict();
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const taskSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    number: z.number().int(),
    title: z.string(),
    description: z.string(),
    state: workflowStateSchema,
    priority,
    assignee: z
      .object({ userId: z.uuid(), displayName: z.string() })
      .strict()
      .nullable(),
    dueAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    parent: z
      .object({ number: z.number().int(), key: z.string() })
      .strict()
      .nullable(),
    labels: z.array(labelSchema),
    milestone: z
      .object({ id: z.uuid(), title: z.string() })
      .strict()
      .nullable(),
    fields: z.record(z.string(), z.union([z.string(), z.number()])),
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Task = z.infer<typeof taskSchema>;

export const taskListResponseSchema = z
  .object({
    tasks: z.array(taskSchema),
    nextCursor: z.number().int().nullable(),
  })
  .strict();
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;

export const commentBodySchema = z
  .object({ body: z.string().trim().min(1).max(10000) })
  .strict();

export const commentSchema = z
  .object({
    id: z.uuid(),
    author: z.object({ userId: z.uuid(), displayName: z.string() }).strict(),
    body: z.string().nullable(),
    createdAt: z.iso.datetime(),
    editedAt: z.iso.datetime().nullable(),
    deleted: z.boolean(),
  })
  .strict();
export type Comment = z.infer<typeof commentSchema>;

export const activitySchema = z
  .object({
    id: z.uuid(),
    action: z.string(),
    actor: z.object({ userId: z.uuid(), displayName: z.string() }).strict(),
    changes: z.record(z.string(), z.unknown()),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type Activity = z.infer<typeof activitySchema>;

const stateCategory = z.enum(['todo', 'in_progress', 'done']);
export const createStateRequestSchema = z
  .object({ label: z.string().trim().min(1).max(50), category: stateCategory })
  .strict();
export const updateStateRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(50).optional(),
    category: stateCategory.optional(),
  })
  .strict();
export const reorderStatesRequestSchema = z
  .object({ stateIds: z.array(z.uuid()).min(1).max(50) })
  .strict();
export const deleteStateQuerySchema = z
  .object({ moveTo: z.uuid().optional() })
  .strict();

export const dependencyRequestSchema = z
  .object({ blockerNumber: z.number().int().positive() })
  .strict();
const taskRef = z
  .object({
    number: z.number().int(),
    key: z.string(),
    title: z.string(),
    done: z.boolean(),
  })
  .strict();
export const dependenciesResponseSchema = z
  .object({ blockedBy: z.array(taskRef), blocking: z.array(taskRef) })
  .strict();
export type DependenciesResponse = z.infer<typeof dependenciesResponseSchema>;

export const milestoneRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export const updateMilestoneRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(100).optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    status: z.enum(['open', 'closed']).optional(),
  })
  .strict();
export const milestoneSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    dueAt: z.iso.datetime().nullable(),
    status: z.enum(['open', 'closed']),
    taskCount: z.number().int(),
    doneCount: z.number().int(),
  })
  .strict();
export type Milestone = z.infer<typeof milestoneSchema>;

export const viewConfigSchema = z
  .object({
    layout: z.enum(['board', 'list', 'table', 'calendar']),
    filters: z
      .object({
        state: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        assignee: z.union([z.uuid(), z.enum(['me', 'none'])]).optional(),
        priority: priority.optional(),
        label: z.uuid().optional(),
        milestone: z.union([z.uuid(), z.literal('none')]).optional(),
      })
      .strict()
      .default({}),
    sort: z
      .object({
        field: z.enum([
          'number',
          'title',
          'priority',
          'due',
          'state',
          'assignee',
        ]),
        direction: z.enum(['asc', 'desc']),
      })
      .strict()
      .default({ field: 'number', direction: 'asc' }),
  })
  .strict();
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const createViewRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    shared: z.boolean().default(false),
    config: viewConfigSchema,
  })
  .strict();

export const savedViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    shared: z.boolean(),
    mine: z.boolean(),
    owner: z.string(),
    config: viewConfigSchema,
  })
  .strict();
export type SavedView = z.infer<typeof savedViewSchema>;

const fieldName = z.string().trim().min(1).max(40);
const fieldOptions = z
  .array(z.string().trim().min(1).max(40))
  .min(1)
  .max(30)
  .refine((o) => new Set(o.map((v) => v.toLowerCase())).size === o.length, {
    message: 'options must be unique',
  });
export const createFieldRequestSchema = z.discriminatedUnion('type', [
  z.object({ name: fieldName, type: z.literal('text') }).strict(),
  z.object({ name: fieldName, type: z.literal('number') }).strict(),
  z.object({ name: fieldName, type: z.literal('date') }).strict(),
  z
    .object({
      name: fieldName,
      type: z.literal('select'),
      options: fieldOptions,
    })
    .strict(),
]);
export type CreateFieldRequest = z.infer<typeof createFieldRequestSchema>;
export const updateFieldRequestSchema = z
  .object({ name: fieldName.optional(), options: fieldOptions.optional() })
  .strict();
export const customFieldSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(['text', 'number', 'date', 'select']),
    options: z.array(z.string()),
    position: z.number().int(),
  })
  .strict();
export type CustomField = z.infer<typeof customFieldSchema>;
export const setFieldValueRequestSchema = z
  .object({ value: z.union([z.string().max(500), z.number(), z.null()]) })
  .strict();

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
