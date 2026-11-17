import { timingSafeEqual } from 'node:crypto';

/**
 * A minimal Prometheus registry (text exposition format 0.0.4) so the API
 * and worker can expose metrics without a client library (ADR-041).
 */
type Labels = Record<string, string>;

function key(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map(
      (k) =>
        `${k}="${String(labels[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    )
    .join(',');
}

function line(name: string, labels: string, value: number): string {
  return `${name}${labels ? `{${labels}}` : ''} ${Number.isFinite(value) ? value : 0}`;
}

export class Counter {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }

  render(): string[] {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      ...[...this.values].map(([k, v]) => line(this.name, k, v)),
    ];
  }
}

export class Histogram {
  private readonly series = new Map<
    string,
    { counts: number[]; sum: number; count: number }
  >();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: number[] = [
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
    ],
  ) {}

  observe(labels: Labels, value: number): void {
    const k = key(labels);
    const s = this.series.get(k) ?? {
      counts: this.buckets.map(() => 0),
      sum: 0,
      count: 0,
    };
    this.buckets.forEach((b, i) => {
      if (value <= b) s.counts[i] = (s.counts[i] ?? 0) + 1;
    });
    s.sum += value;
    s.count += 1;
    this.series.set(k, s);
  }

  render(): string[] {
    const out = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const [k, s] of this.series) {
      const prefix = k ? `${k},` : '';
      this.buckets.forEach((b, i) =>
        out.push(
          line(`${this.name}_bucket`, `${prefix}le="${b}"`, s.counts[i] ?? 0),
        ),
      );
      out.push(line(`${this.name}_bucket`, `${prefix}le="+Inf"`, s.count));
      out.push(line(`${this.name}_sum`, k, s.sum));
      out.push(line(`${this.name}_count`, k, s.count));
    }
    return out;
  }
}

/** A gauge whose value is read when metrics are scraped. */
export interface GaugeReading {
  name: string;
  help: string;
  values: { labels?: Labels; value: number }[];
}

export class Registry {
  private readonly metrics: (Counter | Histogram)[] = [];

  counter(name: string, help: string): Counter {
    const metric = new Counter(name, help);
    this.metrics.push(metric);
    return metric;
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    const metric = new Histogram(name, help, buckets);
    this.metrics.push(metric);
    return metric;
  }

  render(gauges: GaugeReading[] = []): string {
    const lines = this.metrics.flatMap((m) => m.render());
    for (const gauge of gauges) {
      lines.push(
        `# HELP ${gauge.name} ${gauge.help}`,
        `# TYPE ${gauge.name} gauge`,
      );
      for (const v of gauge.values)
        lines.push(line(gauge.name, key(v.labels ?? {}), v.value));
    }
    return `${lines.join('\n')}\n`;
  }
}

/** Constant-time check of `Authorization: Bearer <METRICS_TOKEN>`. */
export function metricsAuthorized(
  header: string | undefined,
  token: string | undefined,
): boolean {
  if (!token || token.length < 16 || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
