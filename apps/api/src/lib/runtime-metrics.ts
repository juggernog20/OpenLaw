// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-036 process metrics for Settings → Advanced → System status.
 *
 * Each process counts in memory. A request adds one to a counter and one
 * to a response-time bucket, and nothing is written per request. The
 * heartbeat loop takes a snapshot once a minute, which resets the
 * counters, and writes it as one `runtime_metrics` row.
 *
 * Response times are kept as bucket counts, not as percentiles, because
 * bucket counts add up across minutes and processes. A percentile of
 * percentiles does not.
 */

import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Upper bounds of the response-time buckets, in milliseconds. One more
 * bucket after the last bound holds every slower response. Changing the
 * bounds changes the meaning of stored rows, so a change must wait until
 * the 24-hour retention has cleared the old ones.
 */
export const LATENCY_BUCKET_BOUNDS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
] as const;

export interface MetricsSnapshot {
  intervalMs: number;
  requests: number | null;
  serverErrors: number | null;
  latencyBuckets: number[] | null;
  eventLoopP99Ms: number;
  cpuPercent: number;
  rssBytes: number;
  heapUsedBytes: number;
}

export interface RuntimeMetrics {
  /** Counts one finished request. A process that serves none never calls it. */
  recordRequest(durationMs: number, statusCode: number): void;
  /** Returns the numbers since the last snapshot and starts a new interval. */
  snapshot(): MetricsSnapshot;
  stop(): void;
}

export function createRuntimeMetrics(options: { servesRequests: boolean }): RuntimeMetrics {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const emptyBuckets = () => new Array<number>(LATENCY_BUCKET_BOUNDS_MS.length + 1).fill(0);
  let buckets = emptyBuckets();
  let requests = 0;
  let serverErrors = 0;
  let since = performance.now();
  let cpu = process.cpuUsage();
  return {
    recordRequest(durationMs, statusCode) {
      requests += 1;
      if (statusCode >= 500) serverErrors += 1;
      let index = 0;
      while (
        index < LATENCY_BUCKET_BOUNDS_MS.length &&
        durationMs > LATENCY_BUCKET_BOUNDS_MS[index]!
      )
        index += 1;
      buckets[index]! += 1;
    },
    snapshot() {
      const now = performance.now();
      const intervalMs = Math.max(1, Math.round(now - since));
      const used = process.cpuUsage(cpu);
      const memory = process.memoryUsage();
      // The histogram reports nanoseconds, and NaN before its first sample.
      const loopP99 = loop.percentile(99) / 1e6;
      const result: MetricsSnapshot = {
        intervalMs,
        requests: options.servesRequests ? requests : null,
        serverErrors: options.servesRequests ? serverErrors : null,
        latencyBuckets: options.servesRequests ? buckets : null,
        eventLoopP99Ms: Number.isFinite(loopP99) ? loopP99 : 0,
        // Share of one core: 100 means one core was busy for the whole interval.
        cpuPercent: ((used.user + used.system) / 1000 / intervalMs) * 100,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
      };
      buckets = emptyBuckets();
      requests = 0;
      serverErrors = 0;
      since = now;
      cpu = process.cpuUsage();
      loop.reset();
      return result;
    },
    stop() {
      loop.disable();
    },
  };
}

/**
 * Estimates a percentile from summed bucket counts. The answer is
 * interpolated inside the bucket that holds the rank, which is the
 * estimate Prometheus makes. A rank in the last bucket answers with the
 * last bound, because that bucket has no upper edge.
 */
export function bucketPercentile(buckets: readonly number[], quantile: number): number | null {
  const total = buckets.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const rank = quantile * total;
  let seen = 0;
  for (const [index, count] of buckets.entries()) {
    if (count > 0 && seen + count >= rank) {
      const upper = LATENCY_BUCKET_BOUNDS_MS[index];
      if (upper === undefined) return LATENCY_BUCKET_BOUNDS_MS.at(-1)!;
      const lower = index === 0 ? 0 : LATENCY_BUCKET_BOUNDS_MS[index - 1]!;
      return lower + (upper - lower) * ((rank - seen) / count);
    }
    seen += count;
  }
  return LATENCY_BUCKET_BOUNDS_MS.at(-1)!;
}
