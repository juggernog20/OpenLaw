-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "ai_connector"
  DROP CONSTRAINT "ai_connector_preset_check",
  ADD CONSTRAINT "ai_connector_preset_check" CHECK ("preset" IN ('anthropic', 'openai', 'azure_openai', 'gemini', 'openrouter', 'groq', 'ollama', 'custom'));
