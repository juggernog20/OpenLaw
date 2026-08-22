-- The comment_attachments table (CMT-011). The table, its four foreign
-- keys, and its index are one act, so the file opens its own transaction
-- (TECH-006's 2026-08-21 addendum): an install crossing 0054's literal
-- `COMMIT;` on the way here arrives in autocommit, and a failed foreign
-- key must not leave the table half installed.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
CREATE TABLE "comment_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"comment_id" text NOT NULL,
	"file_ref" text NOT NULL,
	"filename" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"filed_document_id" text,
	"filed_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_filed_document_id_documents_id_fk" FOREIGN KEY ("filed_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_filed_version_id_document_versions_id_fk" FOREIGN KEY ("filed_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_attachments_comment_idx" ON "comment_attachments" USING btree ("comment_id","created_at","id");--> statement-breakpoint
COMMIT;
