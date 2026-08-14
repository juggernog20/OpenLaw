CREATE TABLE "document_version_text" (
	"version_id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"source" text,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_version_text_state_check" CHECK ("document_version_text"."state" in ('pending', 'ready', 'failed')),
	CONSTRAINT "document_version_text_source_check" CHECK ("document_version_text"."source" is null or "document_version_text"."source" in ('native_layer', 'ocr')),
	CONSTRAINT "document_version_text_ready_check" CHECK (("document_version_text"."state" = 'ready') = ("document_version_text"."text" is not null and "document_version_text"."source" is not null))
);
--> statement-breakpoint
ALTER TABLE "document_version_text" ADD CONSTRAINT "document_version_text_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;