CREATE TABLE "runtime_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text NOT NULL,
	"role" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"interval_ms" integer NOT NULL,
	"requests" integer,
	"server_errors" integer,
	"latency_buckets" integer[],
	"event_loop_p99_ms" real NOT NULL,
	"cpu_percent" real NOT NULL,
	"rss_bytes" bigint NOT NULL,
	"heap_used_bytes" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "runtime_metrics_recorded_at_idx" ON "runtime_metrics" USING btree ("recorded_at");