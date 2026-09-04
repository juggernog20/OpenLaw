ALTER TABLE "document_versions" ADD COLUMN "source" text DEFAULT 'uploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "compared_from_version_id" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "compared_to_version_id" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_compared_from_version_id_document_versions_id_fk" FOREIGN KEY ("compared_from_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_compared_to_version_id_document_versions_id_fk" FOREIGN KEY ("compared_to_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_source_check" CHECK ("document_versions"."source" in ('uploaded', 'generated'));--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_generated_provenance_check" CHECK ((
        ("document_versions"."kind" = 'generated_redline' and "document_versions"."source" = 'generated' and "document_versions"."compared_from_version_id" is not null and "document_versions"."compared_to_version_id" is not null)
        or
        ("document_versions"."kind" <> 'generated_redline' and "document_versions"."source" = 'uploaded' and "document_versions"."compared_from_version_id" is null and "document_versions"."compared_to_version_id" is null)
      ));