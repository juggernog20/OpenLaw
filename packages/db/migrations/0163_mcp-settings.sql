-- SPDX-License-Identifier: AGPL-3.0-only

-- TECH-006's #390 preamble: the MCP settings columns and their check
-- land together. It also reopens the batch's transaction: 0160 and 0161
-- end with a COMMIT of their own, so without a BEGIN here every later
-- statement in the same upgrade would run in autocommit and a failure
-- in this file would leave half its columns behind (the rehearsal in
-- apps/api/src/mcp-settings-migration.test.ts proves the rollback).
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_legal_api_keys_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_business_api_keys_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_toolset_ceiling" jsonb DEFAULT '["workspace","contracts","matters","tasks","requests","comments","documents","auto-docs","entities","knowledge","people","team","administration"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_read_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_api_key_lifetime_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_mcp_api_key_lifetime_check" CHECK ("org_settings"."mcp_api_key_lifetime_days" between 1 and 365);