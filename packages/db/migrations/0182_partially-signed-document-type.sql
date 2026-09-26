ALTER TABLE "document_types" DROP CONSTRAINT "document_types_system_kind_check";--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_kind_check";--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_system_kind_check" CHECK ("document_types"."system_kind" is null or "document_types"."system_kind" in ('draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'partially_signed', 'executed', 'amendment'));--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_kind_check" CHECK ("document_versions"."kind" in ('general', 'draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'partially_signed', 'executed', 'amendment', 'generated_redline'));
--> statement-breakpoint
WITH position AS (
  SELECT coalesce(min(display_order), 1) AS next_order
  FROM document_types WHERE module = 'contract' AND system_kind = 'executed'
)
UPDATE document_types SET display_order = display_order + 1
WHERE module = 'contract' AND archived_at IS NULL
  AND display_order >= (SELECT next_order FROM position)
  AND NOT EXISTS (SELECT 1 FROM document_types WHERE module = 'contract' AND slug = 'partially_signed');
--> statement-breakpoint
INSERT INTO document_types (id, module, slug, display_name, display_order, is_system_default, system_kind)
SELECT '01a0dea0-0000-7000-8000-000000000002', 'contract', 'partially_signed', 'Partially signed',
  coalesce((SELECT min(display_order) - 1 FROM document_types WHERE module = 'contract' AND system_kind = 'executed'), 1),
  true, 'partially_signed'
ON CONFLICT (module, slug) DO UPDATE SET system_kind = 'partially_signed', is_system_default = true, archived_at = NULL;
--> statement-breakpoint
UPDATE document_versions AS version
SET kind = 'partially_signed', document_type_id = type.id
FROM contract_envelopes AS envelope, document_types AS type
WHERE envelope.executed_version_id = version.id AND NOT envelope.completes_contract
  AND version.kind = 'general' AND version.document_type_id IS NULL AND version.source = 'uploaded'
  AND type.module = 'contract' AND type.system_kind = 'partially_signed';
--> statement-breakpoint
UPDATE document_versions AS version SET note = NULL
FROM contract_envelopes AS envelope
WHERE envelope.executed_version_id = version.id AND NOT envelope.completes_contract
  AND version.note = 'Partially signed; additional signatures are required.';
