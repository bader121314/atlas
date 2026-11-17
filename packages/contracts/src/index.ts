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

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: password,
  })
  .strict();
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

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
    /** Everyone assigned, primary first (ADR-046). */
    assignees: z.array(
      z.object({ userId: z.uuid(), displayName: z.string() }).strict(),
    ),
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

/** Replaces a task's assignees; the first becomes primary (ADR-046). */
export const setAssigneesRequestSchema = z
  .object({
    userIds: z
      .array(z.uuid())
      .max(10)
      .refine(
        (list) => new Set(list).size === list.length,
        'Duplicate assignee',
      ),
  })
  .strict();

export const commentBodySchema = z
  .object({ body: z.string().trim().min(1).max(10000) })
  .strict();

/** A new comment; mentioned people are notified (ADR-045). */
export const createCommentRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(10000),
    mentions: z
      .array(z.uuid())
      .max(20)
      .refine((list) => new Set(list).size === list.length, 'Duplicate mention')
      .default([]),
  })
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

/**
 * A project event as published to Redis and streamed to browsers (ADR-028).
 * Deliberately minimal: clients refetch what changed through the API, which
 * applies the usual access checks.
 */
export const projectEventSchema = z
  .object({
    id: z.uuid(),
    type: z.string().max(64),
    organizationId: z.uuid(),
    projectId: z.uuid(),
    taskId: z.uuid(),
    version: z.number().int(),
    actorUserId: z.uuid().nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type ProjectEvent = z.infer<typeof projectEventSchema>;

/** People viewing a task now (ADR-030). */
export const presenceSchema = z
  .object({
    viewers: z.array(
      z.object({ userId: z.uuid(), displayName: z.string() }).strict(),
    ),
  })
  .strict();
export type Presence = z.infer<typeof presenceSchema>;

/** An in-app notification (ADR-031). */
export const notificationSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['task.assigned', 'comment.created', 'mention']),
    actor: z.string().nullable(),
    task: z
      .object({
        key: z.string(),
        projectKey: z.string(),
        number: z.number().int(),
        title: z.string(),
      })
      .strict(),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
  })
  .strict();
export type Notification = z.infer<typeof notificationSchema>;

export const notificationQuerySchema = z
  .object({ unread: z.enum(['true', 'false']).optional() })
  .strict();

export const markNotificationsReadRequestSchema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export const notificationKinds = [
  'task.assigned',
  'comment.created',
  'mention',
] as const;

/**
 * Per-organization notification preferences (ADR-048). `email` is kept for
 * older clients: true means instant, false means off.
 */
export const notificationSettingsSchema = z
  .object({
    email: z.boolean(),
    emailMode: z.enum(['instant', 'daily', 'off']),
    muted: z.array(z.enum(notificationKinds)),
  })
  .strict();

export const updateNotificationSettingsSchema = z
  .object({
    email: z.boolean().optional(),
    emailMode: z.enum(['instant', 'daily', 'off']).optional(),
    muted: z
      .array(z.enum(notificationKinds))
      .refine((list) => new Set(list).size === list.length, 'Duplicate kind')
      .optional(),
  })
  .strict();
export type UpdateNotificationSettings = z.infer<
  typeof updateNotificationSettingsSchema
>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const searchQuerySchema = z
  .object({ q: z.string().trim().min(1).max(200) })
  .strict();

/** One task found by search (ADR-032). */
export const searchResultSchema = z
  .object({
    key: z.string(),
    projectKey: z.string(),
    projectName: z.string(),
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    /** Where the words matched: the task itself or one of its comments. */
    matchedIn: z.enum(['task', 'comment']),
  })
  .strict();
export type SearchResult = z.infer<typeof searchResultSchema>;

/** Project numbers for the dashboard (ADR-033). */
export const projectAnalyticsSchema = z
  .object({
    total: z.number().int(),
    done: z.number().int(),
    overdue: z.number().int(),
    unassigned: z.number().int(),
    byState: z.array(
      z
        .object({
          stateId: z.uuid(),
          label: z.string(),
          category: z.enum(['todo', 'in_progress', 'done']),
          count: z.number().int(),
        })
        .strict(),
    ),
    weeks: z.array(
      z
        .object({
          weekStart: z.iso.date(),
          created: z.number().int(),
          completed: z.number().int(),
        })
        .strict(),
    ),
    /** Median days from creation to completion, last 90 days. */
    medianLeadDays: z.number().nullable(),
    openByAssignee: z.array(
      z
        .object({
          userId: z.uuid(),
          displayName: z.string(),
          open: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();
export type ProjectAnalytics = z.infer<typeof projectAnalyticsSchema>;

/** Attachment types; must match ALLOWED_TYPES in @atlas/shared (tested). */
export const attachmentTypes = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
] as const;

export const createAttachmentRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    contentType: z.enum(attachmentTypes),
    size: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
export type CreateAttachmentRequest = z.infer<
  typeof createAttachmentRequestSchema
>;

/** A task attachment (ADR-034). */
export const attachmentSchema = z
  .object({
    id: z.uuid(),
    filename: z.string(),
    contentType: z.enum(attachmentTypes),
    size: z.number().int(),
    status: z.enum(['pending', 'quarantined', 'clean', 'rejected']),
    rejectionReason: z.string().nullable(),
    uploadedBy: z
      .object({ userId: z.uuid(), displayName: z.string() })
      .strict(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Attachment = z.infer<typeof attachmentSchema>;

/** A background CSV export of a project's tasks (ADR-035). */
export const exportSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['queued', 'ready', 'failed', 'expired']),
    rowCount: z.number().int().nullable(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict();
export type TaskExport = z.infer<typeof exportSchema>;

/** Event types for webhooks; must match WEBHOOK_EVENTS in @atlas/shared. */
export const webhookEventTypes = [
  'task.created',
  'task.updated',
  'comment.created',
] as const;
const webhookEvents = z
  .array(z.enum(webhookEventTypes))
  .min(1)
  .refine((list) => new Set(list).size === list.length, 'Duplicate event');

export const createWebhookRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(2000),
    description: z.string().trim().max(200).default(''),
    events: webhookEvents,
  })
  .strict();
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;

export const updateWebhookRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(2000).optional(),
    description: z.string().trim().max(200).optional(),
    events: webhookEvents.optional(),
    status: z.enum(['active', 'paused']).optional(),
  })
  .strict();
export type UpdateWebhookRequest = z.infer<typeof updateWebhookRequestSchema>;

/** A webhook endpoint (ADR-036); the secret is only returned at creation. */
export const webhookEndpointSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    description: z.string(),
    events: z.array(z.enum(webhookEventTypes)),
    status: z.enum(['active', 'paused']),
    consecutiveFailures: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const webhookDeliverySchema = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    eventType: z.string(),
    status: z.enum(['pending', 'delivered', 'failed']),
    attempts: z.number().int(),
    lastStatusCode: z.number().int().nullable(),
    lastError: z.string().nullable(),
    createdAt: z.iso.datetime(),
    deliveredAt: z.iso.datetime().nullable(),
  })
  .strict();
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

/** API token scopes (ADR-037). */
export const apiTokenScopes = ['tasks:read', 'tasks:write'] as const;

export const createApiTokenRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z
      .array(z.enum(apiTokenScopes))
      .min(1)
      .refine((list) => new Set(list).size === list.length, 'Duplicate scope'),
    expiresInDays: z.number().int().min(1).max(365).default(90),
  })
  .strict();
export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>;

export const apiTokenSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    prefix: z.string(),
    scopes: z.array(z.enum(apiTokenScopes)),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type ApiToken = z.infer<typeof apiTokenSchema>;

/** What starts a rule (ADR-038). */
export const automationTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task.created') }).strict(),
  z
    .object({
      type: z.literal('task.state_changed'),
      /** Only when the task moves to this state; any state when absent. */
      toStateId: z.uuid().optional(),
    })
    .strict(),
  z.object({ type: z.literal('comment.created') }).strict(),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

/** All given conditions must hold for the task when the rule runs. */
export const automationConditionsSchema = z
  .object({
    priorities: z.array(priority).min(1).optional(),
    labelId: z.uuid().optional(),
    unassigned: z.boolean().optional(),
  })
  .strict();
export type AutomationConditions = z.infer<typeof automationConditionsSchema>;

export const automationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assign'), userId: z.uuid() }).strict(),
  z.object({ type: z.literal('set_priority'), priority: priority }).strict(),
  z.object({ type: z.literal('add_label'), labelId: z.uuid() }).strict(),
  z.object({ type: z.literal('set_state'), stateId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('comment'),
      body: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const createAutomationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    trigger: automationTriggerSchema,
    conditions: automationConditionsSchema.default({}),
    actions: z.array(automationActionSchema).min(1).max(5),
    enabled: z.boolean().default(true),
  })
  .strict();
export type CreateAutomationRequest = z.infer<
  typeof createAutomationRequestSchema
>;

export const updateAutomationRequestSchema = createAutomationRequestSchema
  .partial()
  .strict();
export type UpdateAutomationRequest = z.infer<
  typeof updateAutomationRequestSchema
>;

export const simulateAutomationRequestSchema = z
  .object({ conditions: automationConditionsSchema })
  .strict();

export const automationRuleSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    enabled: z.boolean(),
    trigger: automationTriggerSchema,
    conditions: automationConditionsSchema,
    actions: z.array(automationActionSchema),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type AutomationRule = z.infer<typeof automationRuleSchema>;

/** The task facts conditions look at. */
export interface ConditionSubject {
  priority: string;
  labelIds: string[];
  assigneeId: string | null;
}

/** True when the task satisfies every condition given (none means true). */
export function matchesConditions(
  task: ConditionSubject,
  conditions: AutomationConditions,
): boolean {
  if (
    conditions.priorities &&
    !conditions.priorities.includes(task.priority as never)
  )
    return false;
  if (conditions.labelId && !task.labelIds.includes(conditions.labelId))
    return false;
  if (
    conditions.unassigned !== undefined &&
    conditions.unassigned !== (task.assigneeId === null)
  )
    return false;
  return true;
}

/** How often a recurring task repeats (ADR-039). */
export const recurrenceFrequencies = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof recurrenceFrequencies)[number];

export const createRecurrenceRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10000).default(''),
    priority: priority.default('none'),
    assigneeId: z.uuid().nullable().default(null),
    frequency: z.enum(recurrenceFrequencies),
    interval: z.number().int().min(1).max(12).default(1),
    dueInDays: z.number().int().min(0).max(365).nullable().default(null),
    /** First occurrence; now when absent. */
    startsAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type CreateRecurrenceRequest = z.infer<
  typeof createRecurrenceRequestSchema
>;

export const setEnabledRequestSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const recurrenceSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    priority,
    assigneeId: z.uuid().nullable(),
    frequency: z.enum(recurrenceFrequencies),
    interval: z.number().int(),
    dueInDays: z.number().int().nullable(),
    nextRunAt: z.iso.datetime(),
    lastRunAt: z.iso.datetime().nullable(),
    enabled: z.boolean(),
  })
  .strict();
export type Recurrence = z.infer<typeof recurrenceSchema>;

/**
 * The first occurrence after `now`, stepping from `from` by the interval.
 * Missed occurrences are skipped, so a worker that was down creates one
 * task, not a backlog. Months keep the day, clamped to the month's end.
 */
export function nextOccurrence(
  from: Date,
  frequency: RecurrenceFrequency,
  interval: number,
  now: Date,
): Date {
  const anchorDay = from.getUTCDate();
  let next = new Date(from.getTime());
  let steps = 0;
  while (next.getTime() <= now.getTime()) {
    steps += 1;
    if (frequency === 'monthly') {
      const target = new Date(
        Date.UTC(
          from.getUTCFullYear(),
          from.getUTCMonth() + steps * interval,
          1,
        ),
      );
      const last = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
      ).getUTCDate();
      target.setUTCDate(Math.min(anchorDay, last));
      target.setUTCHours(
        from.getUTCHours(),
        from.getUTCMinutes(),
        from.getUTCSeconds(),
        0,
      );
      next = target;
    } else {
      const days = frequency === 'daily' ? interval : 7 * interval;
      next = new Date(from.getTime() + steps * days * 86_400_000);
    }
  }
  return next;
}

export const workloadQuerySchema = z
  .object({ weeks: z.coerce.number().int().min(1).max(12).default(6) })
  .strict();

/** Open assigned tasks per person and week of due date (ADR-047). */
export const workloadSchema = z
  .object({
    weekStarts: z.array(z.iso.date()),
    people: z.array(
      z
        .object({
          userId: z.uuid(),
          displayName: z.string(),
          overdue: z.number().int(),
          weeks: z.array(z.number().int()),
          later: z.number().int(),
          noDueDate: z.number().int(),
          total: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();
export type Workload = z.infer<typeof workloadSchema>;

/** Redis channel for one project's events. */
export function projectChannel(organizationId: string, projectId: string) {
  return `atlas:events:${organizationId}:${projectId}`;
}

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
