/**
 * Reads what people type for time spent: "90" (minutes), "45m", "2h",
 * "1h 30m", "1.5h" or "1:30". Returns minutes, or undefined if unreadable
 * or above `max` (a day by default).
 */
export function parseDuration(text: string, max = 1440): number | undefined {
  const value = text.trim().toLowerCase();
  if (value === '') return undefined;
  let minutes: number;
  const clock = /^(\d+):([0-5]\d)$/.exec(value);
  const parts = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(value);
  if (/^\d+$/.test(value)) minutes = Number(value);
  else if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  else if (parts && (parts[1] || parts[2]))
    minutes = Math.round(Number(parts[1] ?? 0) * 60) + Number(parts[2] ?? 0);
  else return undefined;
  return minutes >= 1 && minutes <= max ? minutes : undefined;
}

/** 0 → "0m", 45 → "45m", 120 → "2h", 135 → "2h 15m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
