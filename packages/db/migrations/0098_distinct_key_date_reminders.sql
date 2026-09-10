-- The migrator starts a transaction; concurrent index commands must run outside it.
COMMIT;--> statement-breakpoint
-- Remove an incomplete build before retrying an interrupted migration.
DROP INDEX CONCURRENTLY IF EXISTS "notifications_reminder_idx_v3";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "notifications_reminder_idx_v3" ON "notifications" USING btree ("user_id","event_type","entity_type","entity_id","reminder_date","reminder_offset_days",coalesce(case when "event_type" = 'date.key_date_approaching' then "payload" ->> 'keyDateId' end, '')) WHERE reminder_date is not null;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "notifications_reminder_idx";--> statement-breakpoint
ALTER INDEX "notifications_reminder_idx_v3" RENAME TO "notifications_reminder_idx";
