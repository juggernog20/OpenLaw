CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"jurisdiction" text,
	"formed_on" date,
	"registration_number" text,
	"tax_id" text,
	"registered_agent" text,
	"registered_address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "entities_status_check" CHECK ("entities"."status" in ('active', 'dormant', 'dissolved', 'divested'))
);
--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_entity_type_check";--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_entity_type_id_entity_types_id_fk" FOREIGN KEY ("entity_type_id") REFERENCES "public"."entity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_legal_name_idx" ON "entities" USING btree ("legal_name");--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_entity_type_check" CHECK ("activity_log"."entity_type" in ('matter', 'contract', 'document', 'request', 'user', 'entity', 'system'));