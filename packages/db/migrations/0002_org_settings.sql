CREATE TABLE "org_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_mode" text DEFAULT 'built_in' NOT NULL,
	"magic_link_enabled" boolean DEFAULT true NOT NULL,
	"allowed_email_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_auth_mode_check" CHECK ("org_settings"."auth_mode" in ('built_in', 'oidc'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_settings_singleton" ON "org_settings" USING btree ((true));--> statement-breakpoint
-- Seed the single settings row (TECH-014: the feature that reads it lands in this same change).
INSERT INTO "org_settings" ("id") VALUES ('019fe356-ae63-7ddc-8f09-ca399a667a61');
