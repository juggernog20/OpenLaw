ALTER TABLE "contract_key_dates" ADD COLUMN "reminder_offset_days" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_key_dates" ADD COLUMN "reminder_recipient_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "matter_key_dates" ADD COLUMN "reminder_offset_days" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "matter_key_dates" ADD COLUMN "reminder_recipient_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;