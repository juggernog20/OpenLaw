CREATE TABLE "matter_template_key_dates" (
	"id" text PRIMARY KEY NOT NULL,
	"matter_template_id" text NOT NULL,
	"label" text NOT NULL,
	"offset_days" integer NOT NULL,
	"note" text,
	"display_order" integer NOT NULL,
	CONSTRAINT "matter_template_key_dates_label_check" CHECK (length(btrim("matter_template_key_dates"."label")) between 1 and 200),
	CONSTRAINT "matter_template_key_dates_offset_check" CHECK ("matter_template_key_dates"."offset_days" between 0 and 3650),
	CONSTRAINT "matter_template_key_dates_note_check" CHECK ("matter_template_key_dates"."note" is null or length(btrim("matter_template_key_dates"."note")) between 1 and 2000),
	CONSTRAINT "matter_template_key_dates_order_check" CHECK ("matter_template_key_dates"."display_order" >= 1)
);
--> statement-breakpoint
CREATE TABLE "matter_template_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"matter_template_id" text NOT NULL,
	"title" text NOT NULL,
	"due_offset_days" integer,
	"assignee_role" text DEFAULT 'none' NOT NULL,
	"display_order" integer NOT NULL,
	CONSTRAINT "matter_template_tasks_title_check" CHECK (length(btrim("matter_template_tasks"."title")) between 1 and 200),
	CONSTRAINT "matter_template_tasks_due_offset_check" CHECK ("matter_template_tasks"."due_offset_days" is null or "matter_template_tasks"."due_offset_days" between 0 and 3650),
	CONSTRAINT "matter_template_tasks_order_check" CHECK ("matter_template_tasks"."display_order" >= 1)
);
--> statement-breakpoint
ALTER TABLE "matter_template_key_dates" ADD CONSTRAINT "matter_template_key_dates_matter_template_id_matter_templates_id_fk" FOREIGN KEY ("matter_template_id") REFERENCES "public"."matter_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_template_tasks" ADD CONSTRAINT "matter_template_tasks_matter_template_id_matter_templates_id_fk" FOREIGN KEY ("matter_template_id") REFERENCES "public"."matter_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matter_template_key_dates_order_idx" ON "matter_template_key_dates" USING btree ("matter_template_id","display_order");--> statement-breakpoint
CREATE INDEX "matter_template_tasks_order_idx" ON "matter_template_tasks" USING btree ("matter_template_id","display_order");