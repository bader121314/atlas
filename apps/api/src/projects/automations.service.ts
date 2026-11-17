import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { matchesConditions } from '@atlas/contracts';
import type {
  AutomationConditions,
  AutomationRule,
  CreateAutomationRequest,
} from '@atlas/contracts';
import type { ProjectContext, TenantContext } from '../auth/http';
import { DatabaseService } from '../database.service';

const MAX_RULES = 25;

interface Row {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationRule['trigger'];
  conditions: AutomationRule['conditions'];
  actions: AutomationRule['actions'];
  creator: string;
  created_at: Date;
}

const SELECT = `SELECT r.id, r.name, r.enabled, r.trigger, r.conditions, r.actions,
  u.display_name AS creator, r.created_at
  FROM automation_rules r JOIN users u ON u.id = r.created_by_user_id`;

function toRule(row: Row): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    conditions: row.conditions,
    actions: row.actions,
    createdBy: row.creator,
    createdAt: row.created_at.toISOString(),
  };
}

/** Project automation rules (ADR-038); the worker runs them. */
@Injectable()
export class AutomationsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(
    tenant: TenantContext,
    project: ProjectContext,
  ): Promise<AutomationRule[]> {
    const result = await this.database.pool.query<Row>(
      `${SELECT} WHERE r.organization_id = $1 AND r.project_id = $2 ORDER BY r.created_at`,
      [tenant.organizationId, project.id],
    );
    return result.rows.map(toRule);
  }

  /** Every id a rule mentions must exist in this project or organization. */
  private async validate(
    tenant: TenantContext,
    project: ProjectContext,
    input: Partial<CreateAutomationRequest>,
  ): Promise<void> {
    const states: string[] = [];
    const labels: string[] = [];
    const users: string[] = [];
    if (input.trigger?.type === 'task.state_changed' && input.trigger.toStateId)
      states.push(input.trigger.toStateId);
    if (input.conditions?.labelId) labels.push(input.conditions.labelId);
    for (const action of input.actions ?? []) {
      if (action.type === 'set_state') states.push(action.stateId);
      if (action.type === 'add_label') labels.push(action.labelId);
      if (action.type === 'assign') users.push(action.userId);
    }
    const counts = await this.database.pool.query<{
      states: string;
      labels: string;
      users: string;
    }>(
      `SELECT
         (SELECT count(*) FROM workflow_states WHERE organization_id = $1 AND project_id = $2
            AND id = ANY($3::uuid[])) AS states,
         (SELECT count(*) FROM labels WHERE organization_id = $1 AND id = ANY($4::uuid[])) AS labels,
         (SELECT count(*) FROM organization_memberships WHERE organization_id = $1
            AND state = 'active' AND user_id = ANY($5::uuid[])) AS users`,
      [
        tenant.organizationId,
        project.id,
        [...new Set(states)],
        [...new Set(labels)],
        [...new Set(users)],
      ],
    );
    const row = counts.rows[0];
    if (
      Number(row?.states) !== new Set(states).size ||
      Number(row?.labels) !== new Set(labels).size ||
      Number(row?.users) !== new Set(users).size
    ) {
      throw new BadRequestException(
        'A state, label or person in the rule does not exist here',
      );
    }
  }

  async create(
    tenant: TenantContext,
    project: ProjectContext,
    userId: string,
    input: CreateAutomationRequest,
  ): Promise<AutomationRule> {
    await this.validate(tenant, project, input);
    const count = await this.database.pool.query<{ count: string }>(
      'SELECT count(*) FROM automation_rules WHERE organization_id = $1 AND project_id = $2',
      [tenant.organizationId, project.id],
    );
    if (Number(count.rows[0]?.count) >= MAX_RULES)
      throw new BadRequestException('Rule limit reached');
    const inserted = await this.database.pool.query<{ id: string }>(
      `INSERT INTO automation_rules (organization_id, project_id, name, enabled, trigger,
         conditions, actions, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        tenant.organizationId,
        project.id,
        input.name,
        input.enabled,
        JSON.stringify(input.trigger),
        JSON.stringify(input.conditions),
        JSON.stringify(input.actions),
        userId,
      ],
    );
    return this.get(tenant, project, inserted.rows[0]?.id ?? '');
  }

  async update(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
    input: Partial<CreateAutomationRequest>,
  ): Promise<AutomationRule> {
    await this.validate(tenant, project, input);
    const result = await this.database.pool.query(
      `UPDATE automation_rules SET
         name = COALESCE($4, name), enabled = COALESCE($5, enabled),
         trigger = COALESCE($6, trigger), conditions = COALESCE($7, conditions),
         actions = COALESCE($8, actions), updated_at = now()
       WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [
        tenant.organizationId,
        project.id,
        id,
        input.name ?? null,
        input.enabled ?? null,
        input.trigger ? JSON.stringify(input.trigger) : null,
        input.conditions ? JSON.stringify(input.conditions) : null,
        input.actions ? JSON.stringify(input.actions) : null,
      ],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
    return this.get(tenant, project, id);
  }

  async remove(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ): Promise<void> {
    const result = await this.database.pool.query(
      'DELETE FROM automation_rules WHERE organization_id = $1 AND project_id = $2 AND id = $3',
      [tenant.organizationId, project.id, id],
    );
    if (result.rowCount !== 1) throw new NotFoundException();
  }

  async runs(tenant: TenantContext, project: ProjectContext, id: string) {
    await this.get(tenant, project, id);
    const result = await this.database.pool.query<{
      id: string;
      status: string;
      detail: string | null;
      number: number;
      created_at: Date;
    }>(
      `SELECT r.id, r.status, r.detail, t.number, r.created_at
       FROM automation_runs r JOIN tasks t ON t.id = r.task_id
       WHERE r.organization_id = $1 AND r.project_id = $2 AND r.rule_id = $3
       ORDER BY r.created_at DESC LIMIT 50`,
      [tenant.organizationId, project.id, id],
    );
    return result.rows.map((r) => ({
      id: r.id,
      status: r.status,
      detail: r.detail,
      task: `${project.key}-${r.number}`,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** Which of the latest 50 tasks the conditions would match now; changes nothing. */
  async simulate(
    tenant: TenantContext,
    project: ProjectContext,
    conditions: AutomationConditions,
  ): Promise<{ matched: { key: string; title: string }[]; checked: number }> {
    const tasks = await this.database.pool.query<{
      number: number;
      title: string;
      priority: string;
      assignee_user_id: string | null;
      labels: string[];
    }>(
      `SELECT t.number, t.title, t.priority, t.assignee_user_id,
         ARRAY(SELECT label_id::text FROM task_labels WHERE task_id = t.id) AS labels
       FROM tasks t WHERE t.organization_id = $1 AND t.project_id = $2
       ORDER BY t.number DESC LIMIT 50`,
      [tenant.organizationId, project.id],
    );
    const matched = tasks.rows
      .filter((t) =>
        matchesConditions(
          {
            priority: t.priority,
            labelIds: t.labels,
            assigneeId: t.assignee_user_id,
          },
          conditions,
        ),
      )
      .map((t) => ({ key: `${project.key}-${t.number}`, title: t.title }));
    return { matched, checked: tasks.rows.length };
  }

  private async get(
    tenant: TenantContext,
    project: ProjectContext,
    id: string,
  ): Promise<AutomationRule> {
    const result = await this.database.pool.query<Row>(
      `${SELECT} WHERE r.organization_id = $1 AND r.project_id = $2 AND r.id = $3`,
      [tenant.organizationId, project.id, id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return toRule(row);
  }
}
