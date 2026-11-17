/**
 * Task edits made while the connection is down (ADR-061). Changes to one
 * task merge (a later value for a field replaces an earlier one) and are
 * sent once, with the version the person was looking at, when the browser
 * is back online. Kept in session storage so a reload does not lose them;
 * never in long-lived storage, which would keep data on shared devices.
 */
export interface PendingEdit {
  version: number;
  changes: Record<string, unknown>;
}

const PREFIX = 'atlas:pending-edit:';

export function mergeEdit(
  pending: PendingEdit | undefined,
  version: number,
  changes: Record<string, unknown>,
): PendingEdit {
  // The first offline change fixes the version the edits were based on.
  return {
    version: pending?.version ?? version,
    changes: { ...pending?.changes, ...changes },
  };
}

export function loadPendingEdit(key: string): PendingEdit | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<PendingEdit>;
    return typeof value.version === 'number' &&
      typeof value.changes === 'object' &&
      value.changes !== null
      ? { version: value.version, changes: value.changes }
      : undefined;
  } catch {
    return undefined;
  }
}

export function storePendingEdit(
  key: string,
  edit: PendingEdit | undefined,
): void {
  try {
    if (edit) sessionStorage.setItem(PREFIX + key, JSON.stringify(edit));
    else sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Storage can be unavailable (private modes); the edit stays in memory.
  }
}
