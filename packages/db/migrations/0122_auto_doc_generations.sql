-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "auto_doc_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"auto_doc_id" text NOT NULL,
	"document_version_id" text NOT NULL,
	"form_version_id" text NOT NULL,
	"generated_by" text NOT NULL,
	"answers" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"docx_file_ref" text,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_doc_generations_state_check" CHECK ("auto_doc_generations"."state" in ('pending', 'ready', 'failed')),
	CONSTRAINT "auto_doc_generations_ready_check" CHECK ("auto_doc_generations"."state" <> 'ready' or "auto_doc_generations"."docx_file_ref" is not null),
	CONSTRAINT "auto_doc_generations_failure_check" CHECK ((("auto_doc_generations"."state" = 'failed') = ("auto_doc_generations"."failure" is not null)) and
        ("auto_doc_generations"."failure" is null or (
          jsonb_typeof("auto_doc_generations"."failure") = 'object' and
          jsonb_typeof("auto_doc_generations"."failure"->'code') = 'string' and
          jsonb_typeof("auto_doc_generations"."failure"->'detail') = 'string' and
          nullif(btrim("auto_doc_generations"."failure"->>'code'), '') is not null and
          nullif(btrim("auto_doc_generations"."failure"->>'detail'), '') is not null
        )))
);
--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_auto_doc_id_auto_docs_id_fk" FOREIGN KEY ("auto_doc_id") REFERENCES "public"."auto_docs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_file_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_form_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."auto_doc_form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_doc_generations_auto_doc_idx" ON "auto_doc_generations" USING btree ("auto_doc_id","created_at");--> statement-breakpoint
CREATE INDEX "auto_doc_generations_person_idx" ON "auto_doc_generations" USING btree ("generated_by","created_at");--> statement-breakpoint
CREATE INDEX "auto_doc_generations_file_version_idx" ON "auto_doc_generations" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "auto_doc_generations_form_version_idx" ON "auto_doc_generations" USING btree ("form_version_id");
--> statement-breakpoint
-- Generation history must survive publication changes without losing version ownership.
CREATE FUNCTION check_auto_doc_generation_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT g.id, g.auto_doc_id, g.document_version_id, g.form_version_id
    FROM auto_doc_generations g
    WHERE CASE TG_TABLE_NAME
      WHEN 'auto_doc_generations' THEN g.id = NEW.id
      WHEN 'documents' THEN g.document_version_id IN (SELECT id FROM document_versions WHERE document_id = NEW.id)
      WHEN 'document_versions' THEN g.document_version_id = NEW.id
      ELSE g.form_version_id = NEW.id
    END
  LOOP
    PERFORM 1 FROM document_versions v
      JOIN documents d ON d.id = v.document_id
      JOIN auto_doc_form_versions f ON f.id = candidate.form_version_id
      WHERE v.id = candidate.document_version_id AND d.auto_doc_id = candidate.auto_doc_id
        AND f.auto_doc_id = candidate.auto_doc_id
      FOR SHARE OF v, d, f;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Both Generation versions must belong to its Auto-Doc.'
        USING ERRCODE = '23514', CONSTRAINT = 'auto_doc_generations_pair_owner_check';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auto_doc_generations_pair_owner_check
AFTER INSERT OR UPDATE ON auto_doc_generations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_generation_pair();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER documents_generation_pair_check
AFTER UPDATE ON documents DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_generation_pair();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER document_versions_generation_pair_check
AFTER UPDATE ON document_versions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_generation_pair();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER form_versions_generation_pair_check
AFTER UPDATE ON auto_doc_form_versions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_auto_doc_generation_pair();
