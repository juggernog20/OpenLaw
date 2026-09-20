-- Move the sealed key and its reference together, even after an earlier migration commits.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint

CREATE TABLE "ai_saved_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"preset" text NOT NULL,
	"protocol" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_saved_keys_preset_check" CHECK ("ai_saved_keys"."preset" in ('anthropic', 'openai', 'azure_openai', 'gemini', 'openrouter', 'groq', 'ollama', 'custom')),
	CONSTRAINT "ai_saved_keys_protocol_check" CHECK ("ai_saved_keys"."protocol" in ('anthropic_messages', 'openai_chat_completions', 'gemini'))
);
--> statement-breakpoint
ALTER TABLE "ai_connector" ADD COLUMN "saved_key_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_saved_keys_destination_unique" ON "ai_saved_keys" USING btree ("preset","protocol","base_url");--> statement-breakpoint
ALTER TABLE "ai_connector" ADD CONSTRAINT "ai_connector_saved_key_id_ai_saved_keys_id_fk" FOREIGN KEY ("saved_key_id") REFERENCES "public"."ai_saved_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- The seal binds to the column name, api_key, which is unchanged.
-- Keep the legacy URL spelling; Saved key lookups normalize both sides.
INSERT INTO "ai_saved_keys" ("id", "preset", "protocol", "base_url", "api_key", "created_at", "updated_at")
SELECT "id", "preset", "protocol", "base_url", "api_key", "created_at", "updated_at"
FROM "ai_connector" WHERE "api_key" IS NOT NULL AND "api_key" <> '';--> statement-breakpoint
UPDATE "ai_connector" SET "saved_key_id" = "id"
WHERE "api_key" IS NOT NULL AND "api_key" <> '';--> statement-breakpoint
ALTER TABLE "ai_connector" DROP COLUMN "api_key";
--> statement-breakpoint
COMMIT;
