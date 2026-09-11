ALTER TABLE "contract_analysis_runs" DROP CONSTRAINT "contract_analysis_runs_trigger_check";--> statement-breakpoint
ALTER TABLE "ai_connector" ADD COLUMN "contract_conversion_analysis" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_analysis_runs" ADD COLUMN "source_context" jsonb;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "analysis_human_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_analysis_runs" ADD CONSTRAINT "contract_analysis_runs_trigger_check" CHECK ("contract_analysis_runs"."trigger" in ('automatic', 'manual', 'conversion'));