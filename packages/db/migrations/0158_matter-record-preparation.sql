-- Keep the column and its constraint atomic on every upgrade path.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
ALTER TABLE "conversion_drafts" ADD COLUMN "matter_id" text;--> statement-breakpoint
ALTER TABLE "conversion_drafts" ADD CONSTRAINT "conversion_drafts_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
COMMIT;--> statement-breakpoint
-- Release the schema-change locks before scanning existing drafts.
ALTER TABLE "conversion_drafts" VALIDATE CONSTRAINT "conversion_drafts_matter_id_matters_id_fk";
