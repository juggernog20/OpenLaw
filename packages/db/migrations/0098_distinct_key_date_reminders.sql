-- The migrator starts a transaction; concurrent index commands must run outside it.
COMMIT;--> statement-breakpoint
-- Keep a completed build: it may be the only guard if a retry follows the old index's drop.
-- Only an invalid build needs replacing; DROP CONCURRENTLY cannot run inside this block.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('notifications_reminder_idx_v3') AND NOT indisvalid
  ) THEN
    DROP INDEX "notifications_reminder_idx_v3";
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "notifications_reminder_idx_v3" ON "notifications" USING btree ("user_id","event_type","entity_type","entity_id","reminder_date","reminder_offset_days",coalesce(case when "event_type" = 'date.key_date_approaching' then "payload" ->> 'keyDateId' end, '')) WHERE reminder_date is not null;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "notifications_reminder_idx";--> statement-breakpoint
ALTER INDEX "notifications_reminder_idx_v3" RENAME TO "notifications_reminder_idx";
--> statement-breakpoint
-- Resume the migrator's transaction for its journal row and the migrations that follow.
BEGIN;
