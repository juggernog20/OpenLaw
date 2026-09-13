-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "auto_docs" ADD COLUMN "audience" text DEFAULT 'legal_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "target_contract_type_id" text;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "published_document_version_id" text;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "published_form_version_id" text;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_target_contract_type_id_contract_types_id_fk" FOREIGN KEY ("target_contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_published_document_version_id_document_versions_id_fk" FOREIGN KEY ("published_document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_published_form_fk" FOREIGN KEY ("published_form_version_id") REFERENCES "public"."auto_doc_form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_form_versions" ADD CONSTRAINT "auto_doc_form_fields_map_check" CHECK (not jsonb_path_exists("auto_doc_form_versions"."definition", '$.fields[*] ? (@.catalogFieldId != null && @.contractAttribute != null)'));--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_audience_check" CHECK ("auto_docs"."audience" in ('legal_only', 'selected', 'everyone'));--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_live_pair_check" CHECK (("auto_docs"."published_document_version_id" is null) = ("auto_docs"."published_form_version_id" is null));--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_publication_state_check" CHECK ((("auto_docs"."state" = 'published') = ("auto_docs"."published_document_version_id" is not null)) and (("auto_docs"."published_at" is null) = ("auto_docs"."published_document_version_id" is null)));--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_archive_state_check" CHECK (("auto_docs"."state" = 'archived') = ("auto_docs"."archived_at" is not null));
--> statement-breakpoint
-- Check both the publication and later changes to either Version's owner.
CREATE FUNCTION check_auto_doc_published_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT a.id, a.template_document_id, a.published_document_version_id, a.published_form_version_id
    FROM auto_docs a
    WHERE a.published_document_version_id IS NOT NULL AND
      CASE TG_TABLE_NAME
        WHEN 'auto_docs' THEN a.id = NEW.id
        WHEN 'documents' THEN a.template_document_id = NEW.id
        WHEN 'document_versions' THEN a.published_document_version_id = NEW.id
        ELSE a.published_form_version_id = NEW.id
      END
  LOOP
    PERFORM 1 FROM document_versions v
      JOIN documents d ON d.id = v.document_id
      JOIN auto_doc_form_versions f ON f.id = candidate.published_form_version_id
      WHERE v.id = candidate.published_document_version_id
        AND d.id = candidate.template_document_id AND d.auto_doc_id = candidate.id
        AND f.auto_doc_id = candidate.id
      FOR SHARE OF v, d, f;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Both published versions must belong to this Auto-Doc and its template.'
        USING ERRCODE = '23514', CONSTRAINT = 'auto_docs_published_pair_owner_check';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auto_docs_published_pair_owner_check
AFTER INSERT OR UPDATE ON auto_docs DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_published_pair();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER documents_auto_doc_published_pair_check
AFTER UPDATE ON documents DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_published_pair();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER document_versions_auto_doc_pair_check
AFTER UPDATE ON document_versions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_published_pair();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER form_versions_auto_doc_pair_check
AFTER UPDATE ON auto_doc_form_versions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_published_pair();
