-- Commit the column migration and its journal row before scanning old activity.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
ALTER TABLE "activity_log" VALIDATE CONSTRAINT "activity_log_via_kind_check";
