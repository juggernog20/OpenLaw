COMMIT;--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "notifications_reminder_idx_v2" ON "notifications" USING btree ("user_id","event_type","entity_type","entity_id","reminder_date","reminder_offset_days") WHERE reminder_date is not null;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "notifications_reminder_idx";--> statement-breakpoint
ALTER INDEX "notifications_reminder_idx_v2" RENAME TO "notifications_reminder_idx";