-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "departments" (
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
ALTER TABLE "users" ADD COLUMN "department_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "owning_department_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_slug_unique" ON "departments" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owning_department_id_departments_id_fk" FOREIGN KEY ("owning_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "departments" ("id", "slug", "display_name", "display_order")
SELECT gen_random_uuid()::text,
  coalesce(nullif(trim(both '_' from regexp_replace(lower(name), '[^a-z0-9]+', '_', 'g')), ''), 'department') || '_' || position,
  name, position
FROM (
  SELECT name, row_number() OVER (ORDER BY name)::integer AS position
  FROM (SELECT DISTINCT owning_department AS name FROM contracts WHERE nullif(btrim(owning_department), '') IS NOT NULL) names
) ordered;--> statement-breakpoint
UPDATE "contracts" SET "owning_department_id" = departments.id
FROM "departments" WHERE contracts.owning_department = departments.display_name;--> statement-breakpoint
ALTER TABLE "contracts" DROP COLUMN "owning_department";
