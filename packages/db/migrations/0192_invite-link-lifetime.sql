ALTER TABLE "users" ADD COLUMN "invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "invite_link_lifetime_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_invite_link_lifetime_check" CHECK ("org_settings"."invite_link_lifetime_days" between 1 and 30);