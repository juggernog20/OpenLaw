ALTER TABLE "documents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "contracts_primary_document_idx" ON "contracts" USING btree ("primary_document_id");--> statement-breakpoint
CREATE INDEX "documents_executed_version_idx" ON "documents" USING btree ("executed_version_id");