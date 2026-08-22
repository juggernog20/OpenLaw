-- Makes generated provenance readable now that the kind-correction route
-- must refuse it as both source and target. No API route writes this kind;
-- M32 brings that writer and its comparison operands.
--
-- This is a widening, so every existing row remains valid. Follow 0055's
-- lock shape: add the replacement without a table scan, then validate it
-- under SHARE UPDATE EXCLUSIVE, which does not block ordinary reads and
-- writes. Each statement is safe to retry after an interrupted upgrade.
COMMIT;--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT IF EXISTS "document_versions_kind_check";--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_kind_check" CHECK ("document_versions"."kind" in ('draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'executed', 'amendment', 'generated_redline')) NOT VALID;--> statement-breakpoint
ALTER TABLE "document_versions" VALIDATE CONSTRAINT "document_versions_kind_check";
