-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "auto_doc_generation_origins" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO "auto_doc_generation_origins" ("id") SELECT "id" FROM "auto_doc_generations";
--> statement-breakpoint
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_created_by_generation_id_auto_doc_generations_id_fk";
--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_generated_from_generation_id_auto_doc_generations_id_fk";
--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_id_auto_doc_generation_origins_id_fk" FOREIGN KEY ("id") REFERENCES "public"."auto_doc_generation_origins"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_generation_id_auto_doc_generation_origins_id_fk" FOREIGN KEY ("created_by_generation_id") REFERENCES "public"."auto_doc_generation_origins"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_generated_from_generation_id_auto_doc_generation_origins_id_fk" FOREIGN KEY ("generated_from_generation_id") REFERENCES "public"."auto_doc_generation_origins"("id") ON DELETE no action ON UPDATE no action;
