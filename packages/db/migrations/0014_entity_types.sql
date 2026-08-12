CREATE TABLE "entity_types" (
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
CREATE UNIQUE INDEX "entity_types_slug_unique" ON "entity_types" USING btree ("slug");--> statement-breakpoint
-- Seed the five ENT-001 entity types (TECH-014: the feature that reads
-- them lands in this same change). The `other` row is system-protected
-- in application code — no archive, no hard delete.
INSERT INTO "entity_types" ("id", "slug", "display_name", "display_order", "is_system_default") VALUES
('019ff68b-5530-7962-97e0-f086a338e124', 'corporation', 'Corporation', 1, true),
('019ff68b-5531-7b85-b766-fea75829c6e2', 'llc', 'LLC', 2, true),
('019ff68b-5531-7b85-b766-fea8da093f08', 'partnership', 'Partnership', 3, true),
('019ff68b-5531-7b85-b766-fea9d2df3cf0', 'branch', 'Branch', 4, true),
('019ff68b-5531-7b85-b766-feaa227c19a2', 'other', 'Other', 5, true);
