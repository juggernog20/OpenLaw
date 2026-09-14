-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "auto_doc_filings" (
	"id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"contract_id" text,
	"matter_id" text,
	"document_id" text,
	"created_contract" boolean DEFAULT false NOT NULL,
	"format" text NOT NULL,
	"filed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_doc_filings_owner_check" CHECK (num_nonnulls("auto_doc_filings"."contract_id", "auto_doc_filings"."matter_id") = 1),
	CONSTRAINT "auto_doc_filings_birth_check" CHECK (not "auto_doc_filings"."created_contract" or "auto_doc_filings"."contract_id" is not null),
	CONSTRAINT "auto_doc_filings_format_check" CHECK ("auto_doc_filings"."format" in ('docx', 'pdf'))
);
--> statement-breakpoint
DROP INDEX "contracts_created_by_generation_idx";--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "requested_filing" jsonb;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "filing_failure" jsonb;--> statement-breakpoint
ALTER TABLE "auto_doc_filings" ADD CONSTRAINT "auto_doc_filings_generation_id_auto_doc_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."auto_doc_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_filings" ADD CONSTRAINT "auto_doc_filings_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_filings" ADD CONSTRAINT "auto_doc_filings_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_filings" ADD CONSTRAINT "auto_doc_filings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_filings" ADD CONSTRAINT "auto_doc_filings_filed_by_users_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_doc_filings_generation_idx" ON "auto_doc_filings" USING btree ("generation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_doc_filings_document_idx" ON "auto_doc_filings" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_doc_filings_contract_birth_idx" ON "auto_doc_filings" USING btree ("contract_id") WHERE "auto_doc_filings"."created_contract";--> statement-breakpoint
CREATE INDEX "contracts_created_by_generation_idx" ON "contracts" USING btree ("created_by_generation_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_auto_doc_contract_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
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
  ELSIF TG_TABLE_NAME = 'auto_doc_filings' THEN
    IF TG_OP <> 'INSERT' THEN ids := array_append(ids, OLD.generation_id); END IF;
    IF TG_OP <> 'DELETE' THEN ids := array_append(ids, NEW.generation_id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN ids := array_append(ids, OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN ids := array_append(ids, NEW.id); END IF;
    IF TG_TABLE_NAME = 'documents' THEN
      SELECT array_agg(id) INTO ids FROM (
        SELECT id FROM auto_doc_generations WHERE created_document_id = ANY(ids)
        UNION SELECT f.generation_id FROM auto_doc_filings f WHERE f.document_id = ANY(ids)
      ) affected;
    END IF;
  END IF;
  FOREACH generation_id IN ARRAY coalesce(ids, ARRAY[]::text[]) LOOP
    IF generation_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO g FROM auto_doc_generations WHERE id = generation_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM contracts c WHERE c.created_by_generation_id = g.id
        AND c.id IS DISTINCT FROM g.created_contract_id
        AND NOT EXISTS (SELECT 1 FROM auto_doc_filings f WHERE f.generation_id = g.id AND f.contract_id = c.id AND f.created_contract)
    ) OR (g.created_contract_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM contracts c WHERE c.id = g.created_contract_id AND c.created_by_generation_id = g.id
    )) OR EXISTS (
      SELECT 1 FROM auto_doc_filings f JOIN contracts c ON c.id = f.contract_id
      WHERE f.generation_id = g.id AND f.created_contract
        AND (c.created_by_generation_id IS DISTINCT FROM g.id OR c.id = g.created_contract_id)
    ) THEN
      RAISE EXCEPTION 'The Contract and Generation must name each other through an automatic destination or Filing' USING ERRCODE = '23514';
    END IF;
    IF (g.created_document_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM documents d WHERE d.id = g.created_document_id AND d.contract_id = g.created_contract_id
    )) OR EXISTS (
      SELECT 1 FROM auto_doc_filings f JOIN documents d ON d.id = f.document_id
      WHERE f.generation_id = g.id AND (
        d.contract_id IS DISTINCT FROM f.contract_id OR d.matter_id IS DISTINCT FROM f.matter_id
        OR NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id AND v.version_number = 1 AND v.generated_from_generation_id = g.id)
      )
    ) OR EXISTS (
      SELECT 1 FROM document_versions v JOIN documents d ON d.id = v.document_id
      WHERE v.generated_from_generation_id = g.id
        AND NOT (v.document_id IS NOT DISTINCT FROM g.created_document_id AND d.contract_id IS NOT DISTINCT FROM g.created_contract_id)
        AND NOT EXISTS (SELECT 1 FROM auto_doc_filings f WHERE f.generation_id = g.id AND f.document_id = d.id AND f.contract_id IS NOT DISTINCT FROM d.contract_id AND f.matter_id IS NOT DISTINCT FROM d.matter_id)
    ) THEN
      RAISE EXCEPTION 'A generated Version must belong to its Generation original Contract Document or recorded Filing' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auto_doc_filing_provenance
AFTER INSERT OR UPDATE OR DELETE ON auto_doc_filings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_auto_doc_contract_provenance();
