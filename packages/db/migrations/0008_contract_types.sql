CREATE TABLE "contract_types" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contract_types_slug_unique" ON "contract_types" USING btree ("slug");--> statement-breakpoint
-- Seed the eight CTR-002 contract types (TECH-014: the feature that reads
-- them lands in this same change). The `other` row is system-protected in
-- application code — no archive, no hard delete.
INSERT INTO "contract_types" ("id", "slug", "display_name", "display_order", "is_system_default") VALUES
('019ff1f5-301d-7795-a5af-e4339c76d4ce', 'nda', 'NDA', 1, true),
('019ff1f5-301f-7669-b8f7-ffcea14a5420', 'msa', 'MSA', 2, true),
('019ff1f5-301f-7669-b8f7-ffcf538668e3', 'sow', 'SOW', 3, true),
('019ff1f5-301f-7669-b8f7-ffd06528faea', 'sales', 'Sales', 4, true),
('019ff1f5-301f-7669-b8f7-ffd120d1aef6', 'vendor', 'Vendor', 5, true),
('019ff1f5-301f-7669-b8f7-ffd240ef24b7', 'employment', 'Employment', 6, true),
('019ff1f5-301f-7669-b8f7-ffd321ba5deb', 'license', 'License', 7, true),
('019ff1f5-301f-7669-b8f7-ffd4a4beb547', 'other', 'Other', 8, true);
