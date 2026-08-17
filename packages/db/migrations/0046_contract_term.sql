ALTER TABLE "contracts" ADD COLUMN "term_type" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "effective_date" date;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "renewal_period_months" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "notice_period_days" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_term_type_check" CHECK ("contracts"."term_type" in ('fixed', 'auto_renew', 'evergreen'));--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_evergreen_expiry_check" CHECK ("contracts"."term_type" <> 'evergreen' or "contracts"."expiry_date" is null);--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_renewal_period_term_check" CHECK ("contracts"."term_type" = 'auto_renew' or "contracts"."renewal_period_months" is null);--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_renewal_period_range_check" CHECK ("contracts"."renewal_period_months" is null or "contracts"."renewal_period_months" between 1 and 1200);--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_notice_period_range_check" CHECK ("contracts"."notice_period_days" is null or "contracts"."notice_period_days" between 0 and 36500);