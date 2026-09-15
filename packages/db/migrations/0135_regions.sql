-- SPDX-License-Identifier: AGPL-3.0-only

BEGIN;--> statement-breakpoint
CREATE TABLE "regions" (
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
CREATE UNIQUE INDEX "regions_slug_unique" ON "regions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_display_name_unique" ON "regions" USING btree ("display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_display_name_lower_unique" ON "regions" USING btree (lower("display_name"));--> statement-breakpoint
-- Reconcile current classifications; original Request answers remain historical.
INSERT INTO "regions" ("id", "slug", "display_name", "display_order")
SELECT gen_random_uuid()::text, 'region-' || md5(name), name,
       row_number() OVER (ORDER BY lower(name), name)::integer
FROM (
  SELECT DISTINCT ON (lower(name)) name
  FROM (
    SELECT btrim(region) AS name FROM contracts WHERE nullif(btrim(region), '') IS NOT NULL
    UNION
    SELECT btrim(custom_fields->>'region') AS name FROM requests
    WHERE jsonb_typeof(custom_fields->'region') = 'string'
      AND length(btrim(custom_fields->>'region')) > 0
  ) existing
  ORDER BY lower(name), name COLLATE "C"
) canonical;
--> statement-breakpoint
UPDATE contracts SET region = NULL WHERE region IS NOT NULL AND btrim(region) = '';
--> statement-breakpoint
UPDATE contracts SET region = regions.display_name
FROM regions WHERE lower(btrim(contracts.region)) = lower(regions.display_name)
  AND contracts.region IS DISTINCT FROM regions.display_name;
--> statement-breakpoint
-- Flush deferred reference checks from the backfill before changing the table.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_region_regions_display_name_fk" FOREIGN KEY ("region") REFERENCES "public"."regions"("display_name") ON DELETE no action ON UPDATE cascade NOT VALID;
--> statement-breakpoint
COMMIT;--> statement-breakpoint
ALTER TABLE "contracts" VALIDATE CONSTRAINT "contracts_region_regions_display_name_fk";
