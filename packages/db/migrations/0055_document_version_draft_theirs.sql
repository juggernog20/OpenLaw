-- Widens `document_versions_kind_check` to admit `draft_theirs` (#326,
-- CTR-014). A widening: every row that satisfied the old constraint
-- satisfies this one, so there is nothing to backfill and nothing that
-- can fail validation.
--
-- Run outside the migrator's transaction, as `0054` is, so the two locks
-- are held one at a time rather than both for the length of the whole
-- file. `ADD CONSTRAINT ... NOT VALID` takes ACCESS EXCLUSIVE but skips
-- the scan, so it returns at once; `VALIDATE CONSTRAINT` then does the
-- scan under SHARE UPDATE EXCLUSIVE, which blocks other schema changes
-- but not the reads and writes an install is serving. Adding the
-- constraint validated in one statement would hold ACCESS EXCLUSIVE for
-- the whole scan, which on a large chain is a stall on every download.
--
-- Every statement is safe to re-run, which is what outside-the-
-- transaction costs: a failure part-way leaves what ran in place, and
-- the migration is retried from the top.
COMMIT;--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT IF EXISTS "document_versions_kind_check";--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_kind_check" CHECK ("document_versions"."kind" in ('draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'executed', 'amendment')) NOT VALID;--> statement-breakpoint
ALTER TABLE "document_versions" VALIDATE CONSTRAINT "document_versions_kind_check";
