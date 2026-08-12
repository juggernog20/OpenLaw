CREATE TABLE "matter_type_fields" (
	"matter_type_id" text NOT NULL,
	"field_id" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_type_fields_matter_type_id_field_id_pk" PRIMARY KEY("matter_type_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "matter_types" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matter_type_fields" ADD CONSTRAINT "matter_type_fields_matter_type_id_matter_types_id_fk" FOREIGN KEY ("matter_type_id") REFERENCES "public"."matter_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_type_fields" ADD CONSTRAINT "matter_type_fields_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matter_types_slug_unique" ON "matter_types" USING btree ("slug");--> statement-breakpoint
-- Seed the nine MTR-001 matter types (TECH-014: the feature that reads
-- them lands in this same change). The `other` row is system-protected
-- in application code — no archive, no hard delete.
INSERT INTO "matter_types" ("id", "slug", "display_name", "display_order", "is_system_default") VALUES
('019ff2bc-41c6-70e5-801b-a46a2b3808d9', 'employment', 'Employment', 1, true),
('019ff2bc-41c7-767f-83a6-85e125a31093', 'litigation', 'Litigation', 2, true),
('019ff2bc-41c7-767f-83a6-85e27fc8318b', 'regulatory', 'Regulatory', 3, true),
('019ff2bc-41c7-767f-83a6-85e36c70b0ba', 'commercial', 'Commercial', 4, true),
('019ff2bc-41c7-767f-83a6-85e433518cd3', 'corporate', 'Corporate', 5, true),
('019ff2bc-41c7-767f-83a6-85e53e936cfc', 'ip', 'IP', 6, true),
('019ff2bc-41c7-767f-83a6-85e6c61d029e', 'privacy', 'Privacy', 7, true),
('019ff2bc-41c7-767f-83a6-85e7019fe045', 'advisory', 'Advisory', 8, true),
('019ff2bc-41c7-767f-83a6-85e853ba07d4', 'other', 'Other', 9, true);
