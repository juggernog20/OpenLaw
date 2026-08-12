CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "contracts_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"contract_type_id" text NOT NULL,
	"status_id" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"risk" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "contracts_priority_check" CHECK ("contracts"."priority" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "contracts_risk_check" CHECK ("contracts"."risk" in ('low', 'medium', 'high', 'critical'))
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contract_type_id_contract_types_id_fk" FOREIGN KEY ("contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_status_id_contract_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."contract_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_number_unique" ON "contracts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "contracts_contract_type_idx" ON "contracts" USING btree ("contract_type_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status_id");