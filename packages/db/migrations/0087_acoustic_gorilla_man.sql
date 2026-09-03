CREATE TABLE "document_comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"from_version_id" text NOT NULL,
	"to_version_id" text NOT NULL,
	"mode" text NOT NULL,
	"state" text NOT NULL,
	"change_model" jsonb,
	"change_count" integer,
	"redline_file_ref" text,
	"failure" text,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "document_comparisons_mode_check" CHECK ("document_comparisons"."mode" in ('word', 'text')),
	CONSTRAINT "document_comparisons_state_check" CHECK ("document_comparisons"."state" in ('pending', 'ready', 'failed')),
	CONSTRAINT "document_comparisons_distinct_versions_check" CHECK ("document_comparisons"."from_version_id" <> "document_comparisons"."to_version_id"),
	CONSTRAINT "document_comparisons_change_count_check" CHECK ("document_comparisons"."change_count" is null or "document_comparisons"."change_count" >= 0),
	CONSTRAINT "document_comparisons_outcome_check" CHECK ((
        ("document_comparisons"."state" = 'pending' and "document_comparisons"."change_model" is null and "document_comparisons"."change_count" is null and "document_comparisons"."redline_file_ref" is null and "document_comparisons"."failure" is null and "document_comparisons"."finished_at" is null)
        or
        ("document_comparisons"."state" = 'ready' and "document_comparisons"."change_model" is not null and "document_comparisons"."change_count" is not null and "document_comparisons"."failure" is null and "document_comparisons"."finished_at" is not null and (("document_comparisons"."mode" = 'word' and "document_comparisons"."redline_file_ref" is not null) or ("document_comparisons"."mode" = 'text' and "document_comparisons"."redline_file_ref" is null)))
        or
        ("document_comparisons"."state" = 'failed' and "document_comparisons"."change_model" is null and "document_comparisons"."change_count" is null and "document_comparisons"."redline_file_ref" is null and "document_comparisons"."failure" is not null and "document_comparisons"."finished_at" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_from_version_id_document_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_to_version_id_document_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_comparisons_pair_unique" ON "document_comparisons" USING btree ("document_id","from_version_id","to_version_id");--> statement-breakpoint
CREATE INDEX "document_comparisons_from_version_idx" ON "document_comparisons" USING btree ("from_version_id");--> statement-breakpoint
CREATE INDEX "document_comparisons_to_version_idx" ON "document_comparisons" USING btree ("to_version_id");