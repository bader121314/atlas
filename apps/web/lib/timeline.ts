const DAY = 86_400_000;

export interface Scheduled {
  number: number;
  startAt: string | null;
  dueAt: string | null;
  state: { category: 'todo' | 'in_progress' | 'done' };
}

export interface TimelineBar<T> {
  task: T;
  /** Percent of the window from its start, and width, both 0 to 100. */
  left: number;
  width: number;
  /** The bar continues before or after the window. */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Only a due date: drawn as a marker on that day. */
  dueOnly: boolean;
  overdue: boolean;
}

/** Midnight UTC of the day containing `ms`. */
export function utcDay(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

/** Monday (UTC) of the week containing `ms`. */
export function weekStart(ms: number): number {
  const day = utcDay(ms);
  return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
}

/**
 * Places dated tasks on a window of `days` UTC days from `from` (ADR-052).
 * A task spans its start to its due day inclusive; with only one of the
 * two it occupies that day. Tasks wholly outside the window are counted.
 */
export function layoutTimeline<T extends Scheduled>(
  tasks: T[],
  from: number,
  days: number,
  now: number,
): { bars: TimelineBar<T>[]; outside: number; undated: number } {
  const to = from + days * DAY;
  const today = utcDay(now);
  const bars: TimelineBar<T>[] = [];
  let outside = 0;
  let undated = 0;
  for (const task of tasks) {
    if (!task.startAt && !task.dueAt) {
      undated += 1;
      continue;
    }
    const start = utcDay(Date.parse((task.startAt ?? task.dueAt) as string));
    const end =
      utcDay(Date.parse((task.dueAt ?? task.startAt) as string)) + DAY;
    if (end <= from || start >= to) {
      outside += 1;
      continue;
    }
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    bars.push({
      task,
      left: ((a - from) / (to - from)) * 100,
      width: ((b - a) / (to - from)) * 100,
      clippedStart: start < from,
      clippedEnd: end > to,
      dueOnly: !task.startAt,
      overdue:
        task.state.category !== 'done' && task.dueAt !== null && end <= today,
    });
  }
  bars.sort((x, y) => x.left - y.left || x.task.number - y.task.number);
  return { bars, outside, undated };
}
