-- The cleanup, replacement foreign key, pair check, and supporting index
-- describe one invariant and must land together. Open a transaction
-- explicitly because 0069 leaves the migration session in autocommit
-- (TECH-006's 2026-08-21 addendum).
--
-- The index is deliberately plain rather than CONCURRENTLY: migrations run
-- before /readyz, and concurrent creation cannot share the transaction that
-- makes this rewrite atomic (CTR-024's #391 addendum).
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint

ALTER TABLE "comment_attachments" DROP CONSTRAINT IF EXISTS "comment_attachments_filed_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "comment_attachments" DROP CONSTRAINT IF EXISTS "comment_attachments_filed_version_id_document_versions_id_fk";
--> statement-breakpoint
UPDATE "comment_attachments" AS "attachment"
SET "filed_document_id" = NULL, "filed_version_id" = NULL
WHERE num_nonnulls("attachment"."filed_document_id", "attachment"."filed_version_id") = 1
   OR (
     "attachment"."filed_document_id" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "document_versions" AS "version"
       WHERE "version"."document_id" = "attachment"."filed_document_id"
         AND "version"."id" = "attachment"."filed_version_id"
     )
   );
--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_id_id_idx" ON "document_versions" USING btree ("document_id","id");
--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_filed_version_fk" FOREIGN KEY ("filed_document_id","filed_version_id") REFERENCES "public"."document_versions"("document_id","id") ON DELETE set null ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "comment_attachments" VALIDATE CONSTRAINT "comment_attachments_filed_version_fk";
--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_filed_pair_check" CHECK (("comment_attachments"."filed_document_id" is null and "comment_attachments"."filed_version_id" is null) or ("comment_attachments"."filed_document_id" is not null and "comment_attachments"."filed_version_id" is not null)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "comment_attachments" VALIDATE CONSTRAINT "comment_attachments_filed_pair_check";
--> statement-breakpoint
COMMIT;
