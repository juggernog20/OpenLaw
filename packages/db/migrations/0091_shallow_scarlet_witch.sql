ALTER TABLE "matter_statuses" ADD COLUMN "progression_group" text DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "matter_statuses" ADD CONSTRAINT "matter_statuses_progression_group_check" CHECK ("matter_statuses"."progression_group" in ('open', 'in_progress', 'waiting'));
--> statement-breakpoint
UPDATE "matter_statuses" SET "progression_group" = CASE
  WHEN "slug" IN ('open', 'on_hold') THEN 'open'
  WHEN "slug" ~ '^(with_|awaiting_|waiting_)' THEN 'waiting'
  ELSE 'in_progress'
END;
