ALTER TABLE "org_settings" ADD COLUMN "email_logo_png" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "comment_words_in_email" boolean DEFAULT true NOT NULL;