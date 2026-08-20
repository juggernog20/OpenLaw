CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "requests_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_type_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"summary" text NOT NULL,
	"description" text,
	"urgency" text NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"converted_matter_id" text,
	"converted_contract_id" text,
	"declined_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "requests_converted_target_check" CHECK (num_nonnulls("requests"."converted_matter_id", "requests"."converted_contract_id") <= 1),
	CONSTRAINT "requests_status_check" CHECK ("requests"."status" in ('new', 'converted', 'resolved', 'declined')),
	CONSTRAINT "requests_urgency_check" CHECK ("requests"."urgency" in ('low', 'medium', 'high', 'critical'))
);
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_converted_contract_id_contracts_id_fk" FOREIGN KEY ("converted_contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "requests_number_unique" ON "requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "requests_requester_idx" ON "requests" USING btree ("requester_id","created_at");