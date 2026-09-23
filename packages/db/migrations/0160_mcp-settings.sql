ALTER TABLE "org_settings" ADD COLUMN "mcp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_legal_api_keys_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_business_api_keys_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_toolset_ceiling" jsonb DEFAULT '["workspace","contracts","matters","tasks","requests","comments","documents","auto-docs","entities","knowledge","people","team","administration"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_read_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_api_key_lifetime_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_mcp_api_key_lifetime_check" CHECK ("org_settings"."mcp_api_key_lifetime_days" between 1 and 365);