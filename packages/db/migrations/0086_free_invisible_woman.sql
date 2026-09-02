CREATE TABLE "ai_field_prompts" (
	"slug" text PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"version_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"trigger" text NOT NULL,
	"requested_by" text,
	"preset" text NOT NULL,
	"model" text NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"outcome" jsonb,
	"failure" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "contract_analysis_runs_state_check" CHECK ("contract_analysis_runs"."state" in ('pending', 'ready', 'failed')),
	CONSTRAINT "contract_analysis_runs_trigger_check" CHECK ("contract_analysis_runs"."trigger" in ('automatic', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "ai_unverified" jsonb;--> statement-breakpoint
ALTER TABLE "contract_analysis_runs" ADD CONSTRAINT "contract_analysis_runs_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_analysis_runs" ADD CONSTRAINT "contract_analysis_runs_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_analysis_runs" ADD CONSTRAINT "contract_analysis_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_analysis_runs_contract_idx" ON "contract_analysis_runs" USING btree ("contract_id","id");