// A dependency-free load test (Node 18+). Sends GET requests from a number
// of concurrent workers for a fixed time and reports throughput and latency.
//
//   node scripts/load-test.mjs --url https://atlas.example/api/organizations/x/projects/NW/tasks \
//     --header "Authorization: Bearer atl_..." --concurrency 20 --seconds 30
//
// Exit code 1 when the error rate or p95 latency exceeds the limits given
// with --max-error-rate (default 0.01) and --max-p95-ms (default 500).

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const headers = {};
args.forEach((arg, i) => {
  if (arg === '--header') {
    const [key, ...rest] = args[i + 1].split(':');
    headers[key.trim().toLowerCase()] = rest.join(':').trim();
  }
});

const url = option('url');
if (!url) {
  console.error(
    'usage: load-test.mjs --url <url> [--header "Name: value"] [--concurrency 10] [--seconds 10]',
  );
  process.exit(2);
}
const concurrency = Number(option('concurrency', '10'));
const seconds = Number(option('seconds', '10'));
const maxErrorRate = Number(option('max-error-rate', '0.01'));
const maxP95 = Number(option('max-p95-ms', '500'));

const latencies = [];
const statuses = new Map();
let errors = 0;
const deadline = Date.now() + seconds * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetch(url, { headers });
      await response.arrayBuffer();
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      if (!response.ok) errors += 1;
    } catch {
      errors += 1;
      statuses.set('network', (statuses.get('network') ?? 0) + 1);
    }
    latencies.push(performance.now() - started);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
latencies.sort((a, b) => a - b);
const pick = (q) =>
  latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ??
  0;
const total = latencies.length;
const result = {
  requests: total,
  seconds,
  concurrency,
  perSecond: Math.round(total / seconds),
  errorRate: total ? errors / total : 1,
  p50Ms: Math.round(pick(0.5)),
  p95Ms: Math.round(pick(0.95)),
  p99Ms: Math.round(pick(0.99)),
  statuses: Object.fromEntries(statuses),
};
console.log(`LOAD-TEST ${JSON.stringify(result)}`);
process.exit(result.errorRate > maxErrorRate || result.p95Ms > maxP95 ? 1 : 0);
