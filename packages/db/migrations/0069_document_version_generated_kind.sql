-- Makes generated provenance readable now that the kind-correction route
-- must refuse it as both source and target. No API route writes this kind;
-- M32 brings that writer and its comparison operands.
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_kind_check";--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_kind_check" CHECK ("document_versions"."kind" in ('draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'executed', 'amendment', 'generated_redline'));
