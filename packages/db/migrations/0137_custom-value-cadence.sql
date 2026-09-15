-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "contracts" DROP CONSTRAINT "contracts_value_cadence_check";--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "value_cadence_description" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_value_cadence_description_check" CHECK (("contracts"."value_cadence" = 'other' and "contracts"."value_cadence_description" is not null and length(btrim("contracts"."value_cadence_description")) between 1 and 100) or ("contracts"."value_cadence" is distinct from 'other' and "contracts"."value_cadence_description" is null));--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_value_cadence_check" CHECK ("contracts"."value_cadence" in ('one_time', 'monthly', 'annually', 'other'));
