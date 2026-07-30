/**
 * Metrics — counters, gauges, histograms. In-process registry with a snapshot
 * exporter for the /metrics endpoint. Designed to be scraped by Prometheus in
 * production (the exporter format is OpenMetrics-compatible text).
 */
export interface Counter {
  inc(delta?: number, tags?: Record<string, string>): void;
}
export interface Gauge {
  set(value: number, tags?: Record<string, string>): void;
  inc(delta?: number, tags?: Record<string, string>): void;
  dec(delta?: number, tags?: Record<string, string>): void;
}
export interface Histogram {
  observe(value: number, tags?: Record<string, string>): void;
}

interface MetricEntry {
  readonly type: "counter" | "gauge" | "histogram";
  readonly help: string;
  values: Map<string, number>;
  histogram?: Map<string, { sum: number; count: number; buckets: number[] }>;
  buckets?: readonly number[];
}

export class Metrics {
  private readonly registry = new Map<string, MetricEntry>();

  counter(name: string, help: string): Counter {
    return this.getOrCreate(name, "counter", help);
  }

  gauge(name: string, help: string): Gauge {
    return this.getOrCreate(name, "gauge", help);
  }

  histogram(name: string, help: string, buckets: readonly number[] = DEFAULT_BUCKETS): Histogram {
    const entry = this.getOrCreate(name, "histogram", help);
    (entry as { buckets?: readonly number[] }).buckets = buckets;
    if (!entry.histogram) entry.histogram = new Map();
    return entry as unknown as Histogram;
  }

  snapshot(): MetricsSnapshot {
    const metrics: Array<{
      name: string; type: string; help: string;
      values: Array<{ tags: Record<string, string>; value: number }>;
    }> = [];
    for (const [name, entry] of this.registry) {
      const values: Array<{ tags: Record<string, string>; value: number }> = [];
      for (const [tagKey, value] of entry.values) {
        values.push({ tags: parseTags(tagKey), value });
      }
      metrics.push({ name, type: entry.type, help: entry.help, values });
    }
    return { metrics, collectedAt: new Date().toISOString() };
  }

  /** OpenMetrics-compatible text export. */
  toPrometheusText(): string {
    const lines: string[] = [];
    for (const [name, entry] of this.registry) {
      lines.push(`# HELP ${name} ${entry.help}`);
      lines.push(`# TYPE ${name} ${entry.type}`);
      for (const [tagKey, value] of entry.values) {
        const labelStr = tagKey ? `{${tagKey}}` : "";
        lines.push(`${name}${labelStr} ${value}`);
      }
    }
    return lines.join("\n") + "\n";
  }

  reset(): void {
    for (const entry of this.registry.values()) {
      entry.values.clear();
      entry.histogram?.clear();
    }
  }

  private getOrCreate(name: string, type: MetricEntry["type"], help: string): MetricEntry & Counter & Gauge & Histogram {
    let entry = this.registry.get(name);
    if (!entry) {
      entry = { type, help, values: new Map() };
      this.registry.set(name, entry);
    }
    // Arrow functions capture `this` (the Metrics instance) lexically — no aliasing.
    return {
      ...entry,
      inc: (delta = 1, tags) => { this.bump(name, tags, delta); },
      set: (value, tags) => { this.put(name, tags, value); },
      dec: (delta = 1, tags) => { this.bump(name, tags, -delta); },
      observe: (value, tags) => { this.observeValue(name, tags, value); },
    } as unknown as MetricEntry & Counter & Gauge & Histogram;
  }

  private bump(name: string, tags: Record<string, string> | undefined, delta: number): void {
    const entry = this.registry.get(name)!;
    const key = serializeTags(tags);
    entry.values.set(key, (entry.values.get(key) ?? 0) + delta);
  }

  private put(name: string, tags: Record<string, string> | undefined, value: number): void {
    const entry = this.registry.get(name)!;
    entry.values.set(serializeTags(tags), value);
  }

  private observeValue(name: string, tags: Record<string, string> | undefined, value: number): void {
    const entry = this.registry.get(name)!;
    const key = serializeTags(tags);
    if (!entry.histogram) entry.histogram = new Map();
    let h = entry.histogram.get(key);
    if (!h) {
      h = { sum: 0, count: 0, buckets: new Array((entry.buckets ?? DEFAULT_BUCKETS).length).fill(0) };
      entry.histogram.set(key, h);
    }
    h.sum += value;
    h.count += 1;
    const buckets = entry.buckets ?? DEFAULT_BUCKETS;
    for (let i = 0; i < buckets.length; i++) {
      if (value <= buckets[i]) h.buckets[i] += 1;
    }
  }
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function serializeTags(tags?: Record<string, string>): string {
  if (!tags || Object.keys(tags).length === 0) return "";
  return Object.entries(tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

function parseTags(s: string): Record<string, string> {
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const pair of s.split(",")) {
    const [k, v] = pair.split("=");
    if (k && v) out[k] = v.replace(/^"|"$/g, "");
  }
  return out;
}

export interface MetricsSnapshot {
  readonly metrics: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly help: string;
    readonly values: ReadonlyArray<{ readonly tags: Record<string, string>; readonly value: number }>;
  }>;
  readonly collectedAt: string;
}

let _metrics: Metrics;
export function metrics(): Metrics {
  if (!_metrics) _metrics = new Metrics();
  return _metrics;
}
