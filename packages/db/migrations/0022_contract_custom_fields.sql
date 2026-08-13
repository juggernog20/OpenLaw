ALTER TABLE "contracts" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "contracts_custom_fields_idx" ON "contracts" USING gin ("custom_fields");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_custom_fields_check" CHECK (jsonb_typeof("contracts"."custom_fields") = 'object');