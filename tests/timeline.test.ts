import { describe, expect, it } from 'vitest';
import { layoutTimeline, weekStart } from '../apps/web/lib/timeline';

const from = Date.UTC(2026, 10, 2); // Monday 2 November 2026
const task = (
  number: number,
  startAt: string | null,
  dueAt: string | null,
  category: 'todo' | 'in_progress' | 'done' = 'todo',
) => ({ number, startAt, dueAt, state: { category } });

describe('timeline layout', () => {
  it('finds the Monday of a week in UTC', () => {
    expect(weekStart(Date.UTC(2026, 10, 8, 23))).toBe(from);
    expect(weekStart(from)).toBe(from);
  });

  it('places, clips and counts tasks on a ten-day window', () => {
    const now = Date.UTC(2026, 10, 6, 9);
    const { bars, outside, undated } = layoutTimeline(
      [
        task(1, '2026-11-03T12:00:00Z', '2026-11-04T12:00:00Z'),
        task(2, null, '2026-11-02T12:00:00Z'),
        task(3, '2026-10-20T12:00:00Z', '2026-11-12T12:00:00Z', 'done'),
        task(4, null, null),
        task(5, '2026-12-01T12:00:00Z', null),
      ],
      from,
      10,
      now,
    );
    expect(undated).toBe(1);
    expect(outside).toBe(1);
    expect(bars.map((b) => [b.task.number, b.left, b.width])).toEqual([
      [2, 0, 10],
      [3, 0, 100],
      [1, 10, 20],
    ]);
    const byNumber = new Map(bars.map((b) => [b.task.number, b]));
    expect(byNumber.get(2)).toMatchObject({ dueOnly: true, overdue: true });
    expect(byNumber.get(3)).toMatchObject({
      clippedStart: true,
      clippedEnd: true,
      overdue: false,
    });
    expect(byNumber.get(1)?.overdue).toBe(true);
  });
});
