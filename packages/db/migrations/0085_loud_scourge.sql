CREATE TABLE "ai_connector" (
	"id" text PRIMARY KEY NOT NULL,
	"preset" text NOT NULL,
	"protocol" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text,
	"model" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_connector_preset_check" CHECK ("ai_connector"."preset" in ('anthropic', 'openai', 'azure_openai', 'gemini', 'openrouter', 'ollama', 'custom')),
	CONSTRAINT "ai_connector_protocol_check" CHECK ("ai_connector"."protocol" in ('anthropic_messages', 'openai_chat_completions', 'gemini'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_connector_singleton" ON "ai_connector" USING btree ((true));
