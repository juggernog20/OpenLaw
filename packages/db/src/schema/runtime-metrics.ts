// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-036 performance snapshots. Each API and worker process counts in
 * memory and writes one row a minute beside its heartbeat, so the write
 * rate does not follow the request rate. Rows older than 24 hours are
 * deleted by the same loop that writes them.
 */

import { bigint, index, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { uuidPk } from "./helpers.js";

export const runtimeMetrics = pgTable(
  "runtime_metrics",
  {
    id: uuidPk(),
    // The runtime_status id of the process. Not a foreign key: a clean
    // shutdown deletes the status row, and the history must outlive it.
    processId: text("process_id").notNull(),
    role: text("role").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    intervalMs: integer("interval_ms").notNull(),
    // Request columns are null for a process that serves no requests.
    requests: integer("requests"),
    serverErrors: integer("server_errors"),
    // Counts per response-time bucket. The bounds live with the recorder.
    latencyBuckets: integer("latency_buckets").array(),
    eventLoopP99Ms: real("event_loop_p99_ms").notNull(),
    cpuPercent: real("cpu_percent").notNull(),
    rssBytes: bigint("rss_bytes", { mode: "number" }).notNull(),
    heapUsedBytes: bigint("heap_used_bytes", { mode: "number" }).notNull(),
  },
  (t) => [index("runtime_metrics_recorded_at_idx").on(t.recordedAt)],
);
