-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_generated_provenance_check";--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "contract_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "created_contract_id" text;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "created_document_id" text;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "title_pattern" text;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "fixed_entity_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "created_by_generation_id" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "generated_from_generation_id" text;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_created_contract_id_contracts_id_fk" FOREIGN KEY ("created_contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_created_document_id_documents_id_fk" FOREIGN KEY ("created_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_fixed_entity_id_entities_id_fk" FOREIGN KEY ("fixed_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_generation_id_auto_doc_generations_id_fk" FOREIGN KEY ("created_by_generation_id") REFERENCES "public"."auto_doc_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_generated_from_generation_id_auto_doc_generations_id_fk" FOREIGN KEY ("generated_from_generation_id") REFERENCES "public"."auto_doc_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_doc_generations_created_contract_idx" ON "auto_doc_generations" USING btree ("created_contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_doc_generations_created_document_idx" ON "auto_doc_generations" USING btree ("created_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_created_by_generation_idx" ON "contracts" USING btree ("created_by_generation_id");--> statement-breakpoint
CREATE INDEX "document_versions_generation_idx" ON "document_versions" USING btree ("generated_from_generation_id");--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_generated_provenance_check" CHECK ((
        ("document_versions"."kind" = 'generated_redline' and "document_versions"."source" = 'generated' and "document_versions"."compared_from_version_id" is not null and "document_versions"."compared_to_version_id" is not null and "document_versions"."generated_from_generation_id" is null)
        or
        ("document_versions"."kind" = 'draft_ours' and "document_versions"."source" = 'generated' and "document_versions"."version_number" = 1 and "document_versions"."generated_from_generation_id" is not null and "document_versions"."compared_from_version_id" is null and "document_versions"."compared_to_version_id" is null)
        or
        ("document_versions"."kind" <> 'generated_redline' and "document_versions"."source" = 'uploaded' and "document_versions"."compared_from_version_id" is null and "document_versions"."compared_to_version_id" is null and "document_versions"."generated_from_generation_id" is null)
      ));
--> statement-breakpoint
-- The source CHECK fixes the Version shape. This deferred check binds that
-- Version to the Document and Contract created by the named Generation.
CREATE FUNCTION check_auto_doc_contract_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
  generation_id text;
  g auto_doc_generations%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'contracts' THEN
    IF TG_OP <> 'INSERT' THEN ids := array_append(ids, OLD.created_by_generation_id); END IF;
    IF TG_OP <> 'DELETE' THEN ids := array_append(ids, NEW.created_by_generation_id); END IF;
  ELSIF TG_TABLE_NAME = 'document_versions' THEN
    IF TG_OP <> 'INSERT' THEN ids := array_append(ids, OLD.generated_from_generation_id); END IF;
    IF TG_OP <> 'DELETE' THEN ids := array_append(ids, NEW.generated_from_generation_id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN ids := array_append(ids, OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN ids := array_append(ids, NEW.id); END IF;
    IF TG_TABLE_NAME = 'documents' THEN
      SELECT array_agg(id) INTO ids FROM auto_doc_generations
        WHERE created_document_id = ANY(ids);
    END IF;
  END IF;
  FOREACH generation_id IN ARRAY coalesce(ids, ARRAY[]::text[]) LOOP
    IF generation_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO g FROM auto_doc_generations WHERE id = generation_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM contracts c WHERE c.created_by_generation_id = g.id AND c.id IS DISTINCT FROM g.created_contract_id)
      OR (g.created_contract_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM contracts c WHERE c.id = g.created_contract_id AND c.created_by_generation_id = g.id
      )) THEN
      RAISE EXCEPTION 'The Contract and Generation must name each other' USING ERRCODE = '23514';
    END IF;
    IF (g.created_document_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM documents d WHERE d.id = g.created_document_id AND d.contract_id = g.created_contract_id
      )) OR EXISTS (
        SELECT 1 FROM document_versions v JOIN documents d ON d.id = v.document_id
        WHERE v.generated_from_generation_id = g.id
          AND (v.document_id IS DISTINCT FROM g.created_document_id OR d.contract_id IS DISTINCT FROM g.created_contract_id)
      ) THEN
      RAISE EXCEPTION 'A generated Word Version must belong to its Generation original Contract Document' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auto_doc_generation_contract_provenance
AFTER INSERT OR UPDATE OR DELETE ON auto_doc_generations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_auto_doc_contract_provenance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contract_generation_provenance
AFTER INSERT OR UPDATE OR DELETE ON contracts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_auto_doc_contract_provenance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER document_generation_provenance
AFTER INSERT OR UPDATE OR DELETE ON documents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_auto_doc_contract_provenance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER document_version_generation_provenance
AFTER INSERT OR UPDATE OR DELETE ON document_versions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_auto_doc_contract_provenance();
