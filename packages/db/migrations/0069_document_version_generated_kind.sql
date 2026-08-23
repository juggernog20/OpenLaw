-- Makes generated provenance readable now that the kind-correction route
-- must refuse it as both source and target. No API route writes this kind;
-- M32 brings that writer and its comparison operands.
--
-- The drop and the replacement are one transaction (TECH-006's 2026-08-21
-- addendum), so a failed ADD never leaves `kind` unchecked. The new check
-- lands NOT VALID and is validated after the commit: every existing row
-- already passes the old, narrower check, and validating outside the
-- write transaction keeps the scan from blocking version appends.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_kind_check";--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_kind_check" CHECK ("document_versions"."kind" in ('draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'executed', 'amendment', 'generated_redline')) NOT VALID;--> statement-breakpoint
COMMIT;--> statement-breakpoint
ALTER TABLE "document_versions" VALIDATE CONSTRAINT "document_versions_kind_check";
