-- Concurrent builds run outside the migrator's transaction.
COMMIT;
--> statement-breakpoint
-- These non-unique indexes can be rebuilt after an interrupted attempt.
DROP INDEX CONCURRENTLY IF EXISTS "notifications_open_contract_approval_idx";
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "notifications_open_api_key_approval_idx";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "notifications_open_contract_approval_idx" ON "notifications" USING btree (("payload"->>'approvalId')) WHERE "notifications"."approval_kind" = 'contract' and "notifications"."handled_at" is null;--> statement-breakpoint
CREATE INDEX CONCURRENTLY "notifications_open_api_key_approval_idx" ON "notifications" USING btree ("entity_id") WHERE "notifications"."approval_kind" = 'api_key' and "notifications"."handled_at" is null;
--> statement-breakpoint
-- Resume the transaction for the journal entry and following migrations.
BEGIN;
