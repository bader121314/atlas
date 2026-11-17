'use client';

import { liveStatusText } from '../lib/live';
import type { LiveStatus } from '../lib/live';

/** A quiet indicator of the event stream, announced politely. */
export function LiveStatusBadge({ status }: { status: LiveStatus }) {
  return (
    <p className={`live-status live-${status}`} role="status">
      <span className="live-dot" aria-hidden="true" />
      {liveStatusText(status)}
    </p>
  );
}
