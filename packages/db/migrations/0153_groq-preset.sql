ALTER TABLE "ai_connector" DROP CONSTRAINT "ai_connector_preset_check";
--> statement-breakpoint
ALTER TABLE "ai_connector" ADD CONSTRAINT "ai_connector_preset_check" CHECK ("preset" IN ('anthropic', 'openai', 'azure_openai', 'gemini', 'openrouter', 'groq', 'ollama', 'custom'));
