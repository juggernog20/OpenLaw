-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "auto_doc_form_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"auto_doc_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_doc_form_versions_number_check" CHECK ("auto_doc_form_versions"."version_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "auto_doc_template_scans" (
	"document_version_id" text PRIMARY KEY NOT NULL,
	"detection" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"template_document_id" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "auto_docs_state_check" CHECK ("auto_docs"."state" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_entity_type_check";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_owner_check";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "auto_doc_id" text;--> statement-breakpoint
ALTER TABLE "auto_doc_form_versions" ADD CONSTRAINT "auto_doc_form_versions_auto_doc_id_auto_docs_id_fk" FOREIGN KEY ("auto_doc_id") REFERENCES "public"."auto_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_form_versions" ADD CONSTRAINT "auto_doc_form_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_template_scans" ADD CONSTRAINT "auto_doc_template_scans_version_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_template_document_id_documents_id_fk" FOREIGN KEY ("template_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_doc_form_versions_number_idx" ON "auto_doc_form_versions" USING btree ("auto_doc_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_docs_template_document_idx" ON "auto_docs" USING btree ("template_document_id") WHERE "auto_docs"."template_document_id" is not null;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_auto_doc_id_auto_docs_id_fk" FOREIGN KEY ("auto_doc_id") REFERENCES "public"."auto_docs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_auto_doc_idx" ON "documents" USING btree ("auto_doc_id") WHERE "documents"."auto_doc_id" is not null;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_entity_type_check" CHECK ("activity_log"."entity_type" in ('matter', 'contract', 'document', 'request', 'user', 'entity', 'knowledge_item', 'auto_doc', 'system'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_check" CHECK (num_nonnulls("documents"."matter_id", "documents"."contract_id", "documents"."entity_id", "documents"."knowledge_item_id", "documents"."auto_doc_id") = 1);
--> statement-breakpoint
-- A template pointer must name the Document owned by this Auto-Doc.
-- Deferred because first upload creates both sides in one transaction.
CREATE FUNCTION check_auto_doc_template_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auto_docs a JOIN documents d ON d.id = a.template_document_id
    WHERE (CASE WHEN TG_TABLE_NAME = 'auto_docs' THEN a.id = NEW.id ELSE d.id = NEW.id END)
      AND d.auto_doc_id IS DISTINCT FROM a.id
  ) THEN
    RAISE EXCEPTION 'An Auto-Doc template must belong to that Auto-Doc.'
      USING ERRCODE = '23514', CONSTRAINT = 'auto_docs_template_owner_check';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auto_docs_template_owner_check
AFTER INSERT OR UPDATE ON auto_docs DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_template_owner();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER documents_auto_doc_template_owner_check
AFTER INSERT OR UPDATE ON documents DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_template_owner();
