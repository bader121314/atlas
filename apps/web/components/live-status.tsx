'use client';

import { useT } from '../lib/i18n';
import { liveStatusText } from '../lib/live';
import type { LiveStatus } from '../lib/live';

/** A quiet indicator of the event stream, announced politely. */
export function LiveStatusBadge({ status }: { status: LiveStatus }) {
  const t = useT();
  return (
    <p className={`live-status live-${status}`} role="status">
      <span className="live-dot" aria-hidden="true" />
      {t(liveStatusText(status))}
    </p>
  );
}
