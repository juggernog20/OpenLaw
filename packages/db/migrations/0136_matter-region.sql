-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "matters" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_region_regions_display_name_fk" FOREIGN KEY ("region") REFERENCES "public"."regions"("display_name") ON DELETE no action ON UPDATE cascade;
