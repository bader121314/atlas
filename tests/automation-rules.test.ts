import { describe, expect, it } from 'vitest';
import { matchesConditions } from '../packages/contracts/src';
import { triggers } from '../apps/worker/src/automations/engine';

const task = { priority: 'urgent', labelIds: ['l1'], assigneeId: null };

describe('automation conditions', () => {
  it('requires every given condition', () => {
    expect(matchesConditions(task, {})).toBe(true);
    expect(matchesConditions(task, { priorities: ['urgent', 'high'] })).toBe(
      true,
    );
    expect(matchesConditions(task, { priorities: ['low'] })).toBe(false);
    expect(matchesConditions(task, { labelId: 'l1', unassigned: true })).toBe(
      true,
    );
    expect(matchesConditions(task, { labelId: 'l2' })).toBe(false);
    expect(
      matchesConditions({ ...task, assigneeId: 'u1' }, { unassigned: true }),
    ).toBe(false);
    expect(
      matchesConditions({ ...task, assigneeId: 'u1' }, { unassigned: false }),
    ).toBe(true);
  });
});

describe('automation triggers', () => {
  const event = (
    type: string,
    stateChanged = false,
    stateId: string | null = null,
  ) => ({
    type,
    stateChanged,
    stateId,
  });
  it('matches the event type and optional target state', () => {
    expect(triggers({ type: 'task.created' }, event('task.created'))).toBe(
      true,
    );
    expect(triggers({ type: 'task.created' }, event('task.updated'))).toBe(
      false,
    );
    expect(
      triggers({ type: 'comment.created' }, event('comment.created')),
    ).toBe(true);
    expect(
      triggers(
        { type: 'task.state_changed' },
        event('task.updated', true, 's1'),
      ),
    ).toBe(true);
    expect(
      triggers(
        { type: 'task.state_changed' },
        event('task.updated', false, 's1'),
      ),
    ).toBe(false);
    expect(
      triggers(
        {
          type: 'task.state_changed',
          toStateId: '00000000-0000-4000-8000-000000000002',
        },
        event('task.updated', true, '00000000-0000-4000-8000-000000000001'),
      ),
    ).toBe(false);
  });
});
