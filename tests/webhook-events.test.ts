import { describe, expect, it } from 'vitest';
import { webhookEventTypes } from '../packages/contracts/src';
import { WEBHOOK_EVENTS } from '../packages/shared/src';

describe('webhook event types', () => {
  it('match between the API contract and the worker', () => {
    expect([...webhookEventTypes]).toEqual([...WEBHOOK_EVENTS]);
  });
});
