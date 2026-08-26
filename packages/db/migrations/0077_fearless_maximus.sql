CREATE TABLE "matter_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"matter_type_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_priority" text,
	"default_risk" text,
	"default_custom_fields" jsonb,
	"title_prefix" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matter_templates" ADD CONSTRAINT "matter_templates_matter_type_id_matter_types_id_fk" FOREIGN KEY ("matter_type_id") REFERENCES "public"."matter_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matter_templates_type_idx" ON "matter_templates" USING btree ("matter_type_id","name");