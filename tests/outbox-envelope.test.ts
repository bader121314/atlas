import { describe, expect, it } from 'vitest';
import { projectChannel, projectEventSchema } from '../packages/contracts/src';
import { retryDelayMs, toEnvelope } from '../apps/worker/src/outbox/dispatcher';

const row = {
  id: '6f1c1f5e-4a43-4b35-9a1b-0c1c5d1b7a11',
  organization_id: '0b7f8a0e-1d4c-4b8e-8f43-1b4a0f6f2d22',
  project_id: '7d2c9e1a-5b6f-4c3d-8e9f-2a1b3c4d5e33',
  aggregate_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c44',
  aggregate_version: '3',
  event_type: 'task.updated',
  payload: {
    actorUserId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c55',
    changes: { title: { from: 'a', to: 'b' } },
  },
  occurred_at: new Date('2026-11-17T08:00:00Z'),
  attempt_count: 0,
};

describe('outbox envelopes', () => {
  it('carries ids and the version only, never the change details', () => {
    const envelope = toEnvelope(row);
    expect(projectEventSchema.parse(envelope)).toEqual({
      id: row.id,
      type: 'task.updated',
      organizationId: row.organization_id,
      projectId: row.project_id,
      taskId: row.aggregate_id,
      version: 3,
      actorUserId: row.payload.actorUserId,
      occurredAt: '2026-11-17T08:00:00.000Z',
    });
    expect(JSON.stringify(envelope)).not.toContain('changes');
  });

  it('skips events that belong to no project', () => {
    expect(toEnvelope({ ...row, project_id: null })).toBeUndefined();
  });

  it('uses one channel per organization and project', () => {
    expect(projectChannel('o', 'p')).toBe('atlas:events:o:p');
  });

  it('backs off exponentially up to five minutes', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(retryDelayMs(30)).toBe(300_000);
  });
});
