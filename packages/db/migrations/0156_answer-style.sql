COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
ALTER TABLE "ai_connector" ADD COLUMN "answer_style" text DEFAULT 'sentence' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_connector" ADD CONSTRAINT "ai_connector_answer_style_check" CHECK ("ai_connector"."answer_style" in ('few_words', 'sentence', 'full_clause'));
--> statement-breakpoint
DELETE FROM "ai_field_prompts" WHERE "slug" LIKE 'rules.%';--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "ai_answer_style" text;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_ai_answer_style_check" CHECK ("fields"."ai_answer_style" is null or ("fields"."module_scope" = 'contract' and "fields"."field_type" in ('text', 'long_text') and "fields"."ai_answer_style" in ('few_words', 'sentence', 'full_clause') and ("fields"."ai_answer_style" <> 'full_clause' or "fields"."field_type" = 'long_text')));
