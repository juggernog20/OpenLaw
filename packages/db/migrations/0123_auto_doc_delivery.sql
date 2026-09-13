-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "auto_doc_generations" DROP CONSTRAINT "auto_doc_generations_ready_check";--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "formats" text DEFAULT 'docx' NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "cover_note" text;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "display_values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "pdf_file_ref" text;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "email_state" text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD COLUMN "email_failure" jsonb;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "formats" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "cover_note" text;--> statement-breakpoint
CREATE INDEX "auto_doc_generations_delivery_idx" ON "auto_doc_generations" USING btree ("state","email_state");--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_formats_check" CHECK ("auto_doc_generations"."formats" in ('docx', 'pdf', 'both'));--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_attempt_check" CHECK ("auto_doc_generations"."attempt" > 0);--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_email_state_check" CHECK ("auto_doc_generations"."email_state" in ('not_requested', 'pending', 'sent', 'failed', 'unconfigured'));--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_email_sent_check" CHECK (("auto_doc_generations"."email_state" = 'sent') = ("auto_doc_generations"."email_sent_at" is not null));--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_email_ready_check" CHECK ("auto_doc_generations"."email_state" not in ('sent', 'unconfigured') or "auto_doc_generations"."state" = 'ready');--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_email_failure_check" CHECK ((("auto_doc_generations"."email_state" in ('failed', 'unconfigured')) = ("auto_doc_generations"."email_failure" is not null)) and
        ("auto_doc_generations"."email_failure" is null or (
          jsonb_typeof("auto_doc_generations"."email_failure") = 'object' and
          jsonb_typeof("auto_doc_generations"."email_failure"->'code') = 'string' and
          jsonb_typeof("auto_doc_generations"."email_failure"->'detail') = 'string' and
          nullif(btrim("auto_doc_generations"."email_failure"->>'code'), '') is not null and
          nullif(btrim("auto_doc_generations"."email_failure"->>'detail'), '') is not null
        )));--> statement-breakpoint
ALTER TABLE "auto_doc_generations" ADD CONSTRAINT "auto_doc_generations_ready_check" CHECK ("auto_doc_generations"."state" <> 'ready' or ("auto_doc_generations"."docx_file_ref" is not null and ("auto_doc_generations"."formats" = 'docx' or "auto_doc_generations"."pdf_file_ref" is not null)));--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_formats_check" CHECK ("auto_docs"."formats" in ('docx', 'pdf', 'both'));
