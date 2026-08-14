CREATE TABLE "document_version_rendition" (
	"version_id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"file_ref" text,
	"byte_size" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_version_rendition_state_check" CHECK ("document_version_rendition"."state" in ('pending', 'ready', 'failed')),
	CONSTRAINT "document_version_rendition_ready_check" CHECK (("document_version_rendition"."state" = 'ready') = ("document_version_rendition"."file_ref" is not null and "document_version_rendition"."byte_size" is not null)),
	CONSTRAINT "document_version_rendition_byte_size_check" CHECK ("document_version_rendition"."byte_size" is null or "document_version_rendition"."byte_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "document_version_text" DROP CONSTRAINT "document_version_text_source_check";--> statement-breakpoint
ALTER TABLE "document_version_rendition" ADD CONSTRAINT "document_version_rendition_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version_text" ADD CONSTRAINT "document_version_text_source_check" CHECK ("document_version_text"."source" is null or "document_version_text"."source" in ('native_layer', 'ocr', 'rendition'));