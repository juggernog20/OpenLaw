-- The four paged reads whose index stopped one column short of their
-- cursor (#391). CTR-024 pages on `(created_at, id)` — the id breaks a
-- same-instant tie, and uuidv7 is time-ordered, so that order is still
-- the order things happened in. Two indexes already carry the pair:
-- `activity_log_created_at_idx` for the audit log and
-- `notifications_user_idx` for the bell. These four did not, so each
-- answered the scope and the order and then left Postgres to sort the
-- ties itself. Cheap inside one thread today; the wrong shape for the
-- read the index exists for.
--
-- A column cannot be appended to an index in place, so each one is
-- dropped and rebuilt. The pair must not land alone: a rebuild that
-- failed after its drop would leave the table with no index at all,
-- and the next container start would find nothing to repair because
-- the schema it compares against would already say the index is gone.
--
-- So this file opens its own transaction rather than trusting the one
-- around the batch (TECH-006's 2026-08-21 addendum). An install
-- upgrading from a release before 0054 crosses that file's literal
-- `COMMIT;` on the way here and arrives in autocommit; the COMMIT below
-- closes whichever transaction is open — or none, which Postgres
-- answers with a warning rather than an error — and the BEGIN makes
-- this file all-or-nothing on every upgrade path.
--
-- The indexes are built plainly rather than CONCURRENTLY, for 0060's
-- reason and one more. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction, so using it would trade the property above for a lock
-- nothing is waiting on: migrations run at container start (TECH-005),
-- before the app answers /readyz, so the ACCESS EXCLUSIVE lock these
-- take is held against no traffic of our own.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint

DROP INDEX "activity_log_entity_idx";--> statement-breakpoint
DROP INDEX "comments_entity_idx";--> statement-breakpoint
DROP INDEX "documents_contract_idx";--> statement-breakpoint
DROP INDEX "documents_folder_idx";--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entity_type","entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_entity_idx" ON "comments" USING btree ("entity_type","entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_contract_idx" ON "documents" USING btree ("contract_id","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_folder_idx" ON "documents" USING btree ("folder_id","created_at","id");--> statement-breakpoint

-- Closes the transaction the BEGIN above opened, on 0060's pattern.
COMMIT;
