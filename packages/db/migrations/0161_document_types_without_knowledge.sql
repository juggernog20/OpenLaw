-- DOC-015 addendum: Knowledge files take their item's Knowledge type, so
-- the Knowledge Document type list goes. The rows, any Version that
-- names one, and the tightened check land as one transaction.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
UPDATE "document_versions"
SET "document_type_id" = NULL
WHERE "document_type_id" IN (SELECT "id" FROM "document_types" WHERE "module" = 'knowledge');--> statement-breakpoint
DELETE FROM "document_types" WHERE "module" = 'knowledge';--> statement-breakpoint
ALTER TABLE "document_types" DROP CONSTRAINT "document_types_module_check";--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_module_check" CHECK ("document_types"."module" in ('matter', 'contract', 'entity'));--> statement-breakpoint
COMMIT;
