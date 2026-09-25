ALTER TABLE "org_settings" ALTER COLUMN "mcp_toolset_ceiling" SET DEFAULT '["workspace","contracts","matters","tasks","requests","comments","documents","auto-docs","entities","knowledge","people"]'::jsonb;
--> statement-breakpoint
UPDATE "org_settings" SET "mcp_toolset_ceiling" = "mcp_toolset_ceiling" - 'team' - 'administration';
