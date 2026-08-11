ALTER TABLE "org_settings" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "default_locale" text DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "default_timezone" text DEFAULT 'UTC' NOT NULL;