CREATE TABLE "document_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_folders_name_check" CHECK ("document_folders"."name" <> '' and btrim("document_folders"."name") = "document_folders"."name"
        and length("document_folders"."name") <= 255
        and strpos("document_folders"."name", '/') = 0 and strpos("document_folders"."name", '\') = 0),
	CONSTRAINT "document_folders_parent_check" CHECK ("document_folders"."parent_id" <> "document_folders"."id")
);
--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_parent_id_document_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_folders_contract_idx" ON "document_folders" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_root_name_idx" ON "document_folders" USING btree ("contract_id",lower("name")) WHERE "document_folders"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_sibling_name_idx" ON "document_folders" USING btree ("parent_id",lower("name")) WHERE "document_folders"."parent_id" is not null;