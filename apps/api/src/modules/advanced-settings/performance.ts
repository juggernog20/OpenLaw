// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-036 reads for the System status page. Every number here is read
 * when an Administrator opens or refreshes the page, so the cost is zero
 * while nobody is looking. The snapshots come from `runtime_metrics`; the
 * database and queue numbers come from PostgreSQL itself.
 */

import { sql, type Db } from "@openlaw/db";
import { bucketPercentile } from "../../lib/runtime-metrics.js";

export const performanceWindows = ["5m", "1h", "24h"] as const;
export type PerformanceWindow = (typeof performanceWindows)[number];
const windowIntervals: Record<PerformanceWindow, string> = {
  "5m": "5 minutes",
  "1h": "1 hour",
  "24h": "24 hours",
};
export const metricRoles = ["api", "worker"] as const;

export interface PerformanceRow {
  role: (typeof metricRoles)[number];
  window: PerformanceWindow;
  /** Distinct processes that wrote a snapshot in the window. Zero means no data. */
  processes: number;
  requests: number | null;
  serverErrors: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  /** The worst minute's 99th percentile event loop delay. */
  eventLoopP99Ms: number | null;
  cpuPercent: number | null;
  peakRssBytes: number | null;
}

export async function readPerformance(db: Db): Promise<PerformanceRow[]> {
  const windows = sql.join(
    performanceWindows.map((w) => sql`(${w}, ${windowIntervals[w]}::interval)`),
    sql`, `,
  );
  const totals = await db.execute<{
    role: string;
    window: PerformanceWindow;
    processes: number;
    requests: number | null;
    server_errors: number | null;
    event_loop_p99_ms: number | null;
    cpu_percent: number | null;
    peak_rss_bytes: number | null;
  }>(sql`
    select m.role, w.label as window,
      count(distinct m.process_id)::int as processes,
      sum(m.requests)::float8 as requests,
      sum(m.server_errors)::float8 as server_errors,
      max(m.event_loop_p99_ms)::float8 as event_loop_p99_ms,
      avg(m.cpu_percent)::float8 as cpu_percent,
      max(m.rss_bytes)::float8 as peak_rss_bytes
    from runtime_metrics m
    join (values ${windows}) as w(label, span) on m.recorded_at > now() - w.span
    group by m.role, w.label
  `);
  const buckets = await db.execute<{ role: string; window: string; bucket: number; count: number }>(
    sql`
      select m.role, w.label as window, b.bucket::int as bucket, sum(b.count)::float8 as count
      from runtime_metrics m
      join (values ${windows}) as w(label, span) on m.recorded_at > now() - w.span
      cross join lateral unnest(m.latency_buckets) with ordinality as b(count, bucket)
      group by m.role, w.label, b.bucket
    `,
  );
  return metricRoles.flatMap((role) =>
    performanceWindows.map((window) => {
      const total = totals.rows.find((row) => row.role === role && row.window === window);
      const counts: number[] = [];
      for (const row of buckets.rows)
        if (row.role === role && row.window === window) counts[row.bucket - 1] = row.count;
      const summed = Array.from(counts, (count) => count ?? 0);
      return {
        role,
        window,
        processes: total?.processes ?? 0,
        requests: total?.requests ?? null,
        serverErrors: total?.server_errors ?? null,
        latencyP50Ms: bucketPercentile(summed, 0.5),
        latencyP95Ms: bucketPercentile(summed, 0.95),
        eventLoopP99Ms: total?.event_loop_p99_ms ?? null,
        cpuPercent: total?.cpu_percent ?? null,
        peakRssBytes: total?.peak_rss_bytes ?? null,
      };
    }),
  );
}

/** The latest snapshot per process in the last three minutes, by process id. */
export async function readLatestSnapshots(
  db: Db,
): Promise<Map<string, { cpuPercent: number; rssBytes: number }>> {
  const result = await db.execute<{ process_id: string; cpu_percent: number; rss_bytes: number }>(
    sql`
      select distinct on (process_id) process_id,
        cpu_percent::float8 as cpu_percent, rss_bytes::float8 as rss_bytes
      from runtime_metrics
      where recorded_at > now() - interval '3 minutes'
      order by process_id, recorded_at desc
    `,
  );
  return new Map(
    result.rows.map((row) => [
      row.process_id,
      { cpuPercent: row.cpu_percent, rssBytes: row.rss_bytes },
    ]),
  );
}

export async function readDatabaseStats(db: Db) {
  const result = await db.execute<{
    size_bytes: number;
    connections: number;
    max_connections: number;
  }>(sql`
    select pg_database_size(current_database())::float8 as size_bytes,
      (select count(*)::int from pg_stat_activity where datname = current_database()) as connections,
      current_setting('max_connections')::int as max_connections
  `);
  const row = result.rows[0]!;
  return {
    sizeBytes: row.size_bytes,
    connections: row.connections,
    maxConnections: row.max_connections,
  };
}

const UNDEFINED_TABLE = "42P01";
const INVALID_SCHEMA_NAME = "3F000";

/**
 * Job counts from pg-boss's own table (TECH-007). pg-boss creates its
 * schema when a process first starts the queue, so an install that has
 * not got that far answers null rather than failing the page. Any other
 * error still fails it.
 */
export async function readQueueStats(db: Db) {
  try {
    const result = await db.execute<{
      waiting: number;
      running: number;
      completed: number;
      failed: number;
      oldest_waiting_seconds: number | null;
    }>(sql`
      select
        count(*) filter (where state in ('created', 'retry') and start_after <= now())::int as waiting,
        count(*) filter (where state = 'active')::int as running,
        count(*) filter (where state = 'completed' and completed_on > now() - interval '24 hours')::int as completed,
        count(*) filter (where state = 'failed' and completed_on > now() - interval '24 hours')::int as failed,
        extract(epoch from now() - min(start_after)
          filter (where state in ('created', 'retry') and start_after <= now()))::float8
          as oldest_waiting_seconds
      from pgboss.job
    `);
    const row = result.rows[0]!;
    return {
      waiting: row.waiting,
      running: row.running,
      completedLastDay: row.completed,
      failedLastDay: row.failed,
      oldestWaitingSeconds: row.oldest_waiting_seconds,
    };
  } catch (error) {
    const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
    if (code === UNDEFINED_TABLE || code === INVALID_SCHEMA_NAME) return null;
    throw error;
  }
}
