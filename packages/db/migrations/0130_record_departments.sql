-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "matters" ADD COLUMN "department_id" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "department_id" text;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;