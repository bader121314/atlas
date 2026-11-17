import { Registry } from '@atlas/shared';

/** The worker's metrics (ADR-041). */
export const workerMetrics = new Registry();

const batches = workerMetrics.counter(
  'atlas_worker_batches_total',
  'Worker loop runs by job and result (ok or error).',
);
const seconds = workerMetrics.histogram(
  'atlas_worker_batch_duration_seconds',
  'Worker loop run duration by job.',
  [0.01, 0.05, 0.1, 0.5, 1, 5, 30],
);

/** Runs one batch of a job, recording its result and duration. */
export async function tracked<T>(
  job: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = process.hrtime.bigint();
  try {
    const result = await run();
    batches.inc({ job, result: 'ok' });
    return result;
  } catch (error) {
    batches.inc({ job, result: 'error' });
    throw error;
  } finally {
    seconds.observe({ job }, Number(process.hrtime.bigint() - started) / 1e9);
  }
}
