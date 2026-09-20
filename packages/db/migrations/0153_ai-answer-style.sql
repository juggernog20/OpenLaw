ALTER TABLE "ai_connector" ADD COLUMN "answer_style" text DEFAULT 'sentence' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_connector" ADD CONSTRAINT "ai_connector_answer_style_check" CHECK ("ai_connector"."answer_style" in ('few_words', 'sentence', 'full_clause'));
--> statement-breakpoint
DELETE FROM "ai_field_prompts" WHERE "slug" LIKE 'rules.%';
