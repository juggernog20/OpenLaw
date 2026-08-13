ALTER TABLE "contracts" ADD COLUMN "value_amount" bigint;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "value_currency" char(3);--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "value_cadence" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_value_cadence_check" CHECK ("contracts"."value_cadence" in ('one_time', 'monthly', 'annually'));--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_value_amount_check" CHECK ("contracts"."value_amount" >= 0);--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_value_group_check" CHECK (num_nonnulls("contracts"."value_amount", "contracts"."value_currency", "contracts"."value_cadence") in (0, 3));