CREATE TABLE "matter_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"matter_id" text NOT NULL,
	"title" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"assignee_id" text,
	"due_date" date,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_tasks_title_check" CHECK (length(btrim("matter_tasks"."title")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "matter_tasks" ADD CONSTRAINT "matter_tasks_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_tasks" ADD CONSTRAINT "matter_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matter_tasks_matter_order_idx" ON "matter_tasks" USING btree ("matter_id","display_order");