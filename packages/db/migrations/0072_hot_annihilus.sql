ALTER TABLE "document_folders" ALTER COLUMN "contract_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "contract_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "matter_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "matter_id" text;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_folders_matter_idx" ON "document_folders" USING btree ("matter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_matter_root_name_idx" ON "document_folders" USING btree ("matter_id",lower("name")) WHERE "document_folders"."parent_id" is null and "document_folders"."matter_id" is not null;--> statement-breakpoint
CREATE INDEX "documents_matter_idx" ON "documents" USING btree ("matter_id","created_at","id");--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_owner_check" CHECK (num_nonnulls("document_folders"."matter_id", "document_folders"."contract_id") = 1);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_check" CHECK (num_nonnulls("documents"."matter_id", "documents"."contract_id") = 1);
