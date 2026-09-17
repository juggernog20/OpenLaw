CREATE TABLE "runtime_status" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"config_digest" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "advanced_settings" text;