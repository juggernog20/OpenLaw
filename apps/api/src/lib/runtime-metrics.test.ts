// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  bucketPercentile,
  createRuntimeMetrics,
  LATENCY_BUCKET_BOUNDS_MS,
} from "./runtime-metrics.js";

describe("runtime metrics", () => {
  it("counts requests into buckets and resets on each snapshot", () => {
    const metrics = createRuntimeMetrics({ servesRequests: true });
    try {
      metrics.recordRequest(3, 200);
      metrics.recordRequest(5, 200);
      metrics.recordRequest(40, 404);
      metrics.recordRequest(60_000, 503);
      const first = metrics.snapshot();
      expect(first.requests).toBe(4);
      expect(first.serverErrors).toBe(1);
      // 3 and 5 land in the first bucket: a bound is inclusive.
      expect(first.latencyBuckets![0]).toBe(2);
      expect(first.latencyBuckets![3]).toBe(1);
      expect(first.latencyBuckets!.at(-1)).toBe(1);
      expect(first.latencyBuckets).toHaveLength(LATENCY_BUCKET_BOUNDS_MS.length + 1);
      expect(first.rssBytes).toBeGreaterThan(0);
      expect(first.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(first.eventLoopP99Ms)).toBe(true);
      const second = metrics.snapshot();
      expect(second.requests).toBe(0);
      expect(second.latencyBuckets!.every((count) => count === 0)).toBe(true);
    } finally {
      metrics.stop();
    }
  });

  it("reports no request numbers for a process that serves none", () => {
    const metrics = createRuntimeMetrics({ servesRequests: false });
    try {
      const snapshot = metrics.snapshot();
      expect(snapshot).toMatchObject({ requests: null, serverErrors: null, latencyBuckets: null });
    } finally {
      metrics.stop();
    }
  });

  it("estimates percentiles inside the bucket that holds the rank", () => {
    const empty = new Array<number>(LATENCY_BUCKET_BOUNDS_MS.length + 1).fill(0);
    expect(bucketPercentile(empty, 0.5)).toBeNull();
    // 100 requests, all in the 50–100 ms bucket: the median sits halfway.
    const buckets = [...empty];
    buckets[4] = 100;
    expect(bucketPercentile(buckets, 0.5)).toBe(75);
    expect(bucketPercentile(buckets, 0.95)).toBeCloseTo(97.5);
    // A rank in the open-ended last bucket answers with the last bound.
    const slow = [...empty];
    slow[slow.length - 1] = 1;
    expect(bucketPercentile(slow, 0.95)).toBe(10_000);
  });
});
