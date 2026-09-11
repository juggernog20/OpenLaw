ALTER TABLE "contract_analysis_runs" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_analysis_runs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conversion_drafts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "contracts_unverified_idx" ON "contracts" USING btree ("id") WHERE "contracts"."ai_unverified" is not null;--> statement-breakpoint
CREATE INDEX "matters_unverified_idx" ON "matters" USING btree ("id") WHERE "matters"."ai_unverified" is not null;