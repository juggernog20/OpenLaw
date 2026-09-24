-- DOC-015: Document types. The table, the column, the Contract list's six
-- fixed rows, and the backfill land as one transaction, so an upgrade never
-- stops with Contract Versions pointing at nothing.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"module" text NOT NULL,
	"system_kind" text,
	CONSTRAINT "document_types_module_check" CHECK ("document_types"."module" in ('matter', 'contract', 'entity', 'knowledge')),
	CONSTRAINT "document_types_system_kind_check" CHECK ("document_types"."system_kind" is null or "document_types"."system_kind" in ('draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'executed', 'amendment'))
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "document_type_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_module_slug_unique" ON "document_types" USING btree ("module","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_module_system_kind_unique" ON "document_types" USING btree ("module","system_kind") WHERE "document_types"."system_kind" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_versions_document_type_idx" ON "document_versions" USING btree ("document_type_id");
--> statement-breakpoint
-- The Contract list's fixed rows, one per CTR-014 negotiation kind.
-- Stable ids keep a replay deterministic.
INSERT INTO "document_types"
  ("id", "module", "slug", "display_name", "display_order", "is_system_default", "system_kind")
VALUES
  ('0199d0c0-d0c7-7000-8000-000000000001', 'contract', 'draft_ours', 'Draft · ours', 1, true, 'draft_ours'),
  ('0199d0c0-d0c7-7000-8000-000000000002', 'contract', 'draft_theirs', 'Draft · theirs', 2, true, 'draft_theirs'),
  ('0199d0c0-d0c7-7000-8000-000000000003', 'contract', 'redline_theirs', 'Redline · theirs', 3, true, 'redline_theirs'),
  ('0199d0c0-d0c7-7000-8000-000000000004', 'contract', 'redline_ours', 'Redline · ours', 4, true, 'redline_ours'),
  ('0199d0c0-d0c7-7000-8000-000000000005', 'contract', 'executed', 'Executed', 5, true, 'executed'),
  ('0199d0c0-d0c7-7000-8000-000000000006', 'contract', 'amendment', 'Amendment', 6, true, 'amendment');
--> statement-breakpoint
-- Every Contract Version keeps the label it had: its kind names its type.
-- General and generated redlines have no row, so they stay untyped.
UPDATE "document_versions" AS v
SET "document_type_id" = t."id"
FROM "documents" AS d, "document_types" AS t
WHERE v."document_id" = d."id"
  AND d."contract_id" IS NOT NULL
  AND t."module" = 'contract'
  AND t."system_kind" = v."kind";
--> statement-breakpoint
-- Knowledge Versions lose their negotiation labels. They were upload
-- defaults, and the Knowledge list starts empty.
UPDATE "document_versions" AS v
SET "kind" = 'general'
FROM "documents" AS d
WHERE v."document_id" = d."id"
  AND d."knowledge_item_id" IS NOT NULL
  AND v."source" = 'uploaded'
  AND v."kind" <> 'generated_redline';
--> statement-breakpoint
COMMIT;
