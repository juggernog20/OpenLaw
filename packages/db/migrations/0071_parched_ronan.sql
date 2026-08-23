CREATE TABLE "matter_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"category" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_statuses_category_check" CHECK ("matter_statuses"."category" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "matter_team" (
	"matter_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_team_pkey" PRIMARY KEY("matter_id","user_id","role"),
	CONSTRAINT "matter_team_role_check" CHECK ("matter_team"."role" in ('member', 'watcher', 'creator', 'contributor'))
);
--> statement-breakpoint
CREATE TABLE "matters" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "matters_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"description" text,
	"matter_type_id" text NOT NULL,
	"status_id" text NOT NULL,
	"manager_id" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"risk" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"is_confidential" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "matters_priority_check" CHECK ("matters"."priority" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "matters_risk_check" CHECK ("matters"."risk" is null or "matters"."risk" in ('low', 'medium', 'high', 'critical'))
);
--> statement-breakpoint
ALTER TABLE "matter_team" ADD CONSTRAINT "matter_team_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_team" ADD CONSTRAINT "matter_team_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_matter_type_id_matter_types_id_fk" FOREIGN KEY ("matter_type_id") REFERENCES "public"."matter_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_status_id_matter_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."matter_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matter_statuses_slug_unique" ON "matter_statuses" USING btree ("slug");--> statement-breakpoint
INSERT INTO "matter_statuses" ("id", "slug", "display_name", "category", "display_order", "is_system_default") VALUES
('019dba40-c21f-7a2d-9e10-101f0fba9901', 'open', 'Open', 'open', 1, true),
('019dba40-c21f-7a2d-9e10-101f0fba9902', 'in_progress', 'In progress', 'open', 2, true),
('019dba40-c21f-7a2d-9e10-101f0fba9903', 'on_hold', 'On hold', 'open', 3, true),
('019dba40-c21f-7a2d-9e10-101f0fba9904', 'closed', 'Closed', 'closed', 4, true);--> statement-breakpoint
CREATE INDEX "matter_team_user_idx" ON "matter_team" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matters_number_unique" ON "matters" USING btree ("number");--> statement-breakpoint
CREATE INDEX "matters_type_idx" ON "matters" USING btree ("matter_type_id");--> statement-breakpoint
CREATE INDEX "matters_status_idx" ON "matters" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "matters_manager_idx" ON "matters" USING btree ("manager_id");--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_converted_matter_id_matters_id_fk" FOREIGN KEY ("converted_matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_converted_matter_idx" ON "requests" USING btree ("converted_matter_id");
