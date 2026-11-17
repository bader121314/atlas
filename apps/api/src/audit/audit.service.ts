import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service';
import { summarizeIp } from './ip-summary';

export const AUDIT_TARGETS = [
  'user',
  'session',
  'organization',
  'invitation',
  'project',
  'api_token',
  'share_link',
  'scim_token',
] as const;
type AuditTargetType = (typeof AUDIT_TARGETS)[number];

/** Security-relevant actions. Add new names here, never free text. */
export type AuditAction =
  | 'auth.signup.created'
  | 'auth.email.verified'
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.logout'
  | 'auth.password_reset.requested'
  | 'auth.password_reset.completed'
  | 'auth.password.changed'
  | 'auth.session.revoked'
  | 'auth.sessions.revoked_others'
  | 'org.created'
  | 'org.updated'
  | 'org.invitation.created'
  | 'org.invitation.revoked'
  | 'org.member.joined'
  | 'org.member.role_changed'
  | 'org.member.removed'
  | 'org.member.left'
  | 'project.created'
  | 'project.updated'
  | 'project.member.set'
  | 'project.member.removed'
  | 'api_token.created'
  | 'api_token.revoked'
  | 'share_link.created'
  | 'share_link.revoked'
  | 'org.audit.exported'
  | 'org.member.provisioned'
  | 'org.member.deprovisioned'
  | 'org.member.reactivated'
  | 'scim_token.created'
  | 'scim_token.revoked';

/** Where a request came from; summarized before storage. */
export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

type MetadataValue = string | number | boolean | null;

export interface AuditEvent {
  action: AuditAction;
  actorUserId?: string | null;
  organizationId?: string | null;
  target?: {
    type: AuditTargetType;
    id: string;
  };
  /** Small, non-sensitive facts only: never passwords, tokens or emails. */
  metadata?: Record<string, MetadataValue>;
  request?: RequestMeta;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /**
   * Appends one event. Pass the transaction client when the audited change is
   * transactional, so the change and its audit record commit together.
   */
  async record(event: AuditEvent, client?: PoolClient): Promise<void> {
    const runner = client ?? this.database.pool;
    await runner.query(
      `INSERT INTO audit_events (organization_id, actor_user_id, action,
         target_type, target_id, ip_summary, user_agent_summary, metadata,
         request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.organizationId ?? null,
        event.actorUserId ?? null,
        event.action,
        event.target?.type ?? null,
        event.target?.id ?? null,
        summarizeIp(event.request?.ip),
        event.request?.userAgent?.slice(0, 256) ?? null,
        JSON.stringify(event.metadata ?? {}),
        event.request?.requestId ?? null,
      ],
    );
  }
}
