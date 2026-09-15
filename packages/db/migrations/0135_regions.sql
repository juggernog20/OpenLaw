-- SPDX-License-Identifier: AGPL-3.0-only

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
-- Preserve classifications already stored on Contracts and original intake.
INSERT INTO "regions" ("id", "slug", "display_name", "display_order")
SELECT gen_random_uuid()::text, 'region-' || md5(name), name,
       row_number() OVER (ORDER BY lower(name), name)::integer
FROM (
  SELECT DISTINCT region AS name FROM contracts WHERE region IS NOT NULL
  UNION
  SELECT DISTINCT custom_fields->>'region' AS name FROM requests
  WHERE jsonb_typeof(custom_fields->'region') = 'string'
    AND length(btrim(custom_fields->>'region')) > 0
) existing;
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_region_regions_display_name_fk" FOREIGN KEY ("region") REFERENCES "public"."regions"("display_name") ON DELETE no action ON UPDATE cascade;
