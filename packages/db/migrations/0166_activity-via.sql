ALTER TABLE "activity_log" ADD COLUMN "via_kind" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "via_id" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "via_client_name" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_via_kind_check" CHECK ("activity_log"."via_kind" in ('ui', 'api_key', 'oauth_client'));